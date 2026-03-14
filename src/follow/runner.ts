import { getDb } from "../db/client.js";
import { fetchActivity, type ActivityItem } from "../adapters/polymarket/dataApi.js";
import { fetchMarketsByConditionIds, type GammaMarket } from "../adapters/polymarket/gammaApi.js";
import { fetchMidpoint } from "../adapters/polymarket/clobApi.js";
import { loadProfile } from "../config/profile.js";
import { hasPrivateKey } from "../config/secrets.js";
import { executeLiveOrder } from "../execution/commandAdapter.js";
import { findLeader } from "../leaders/service.js";
import { buildSourceUid } from "../sync/sourceUid.js";
import { formatTimestamp } from "../utils/time.js";

interface StartRunnerOptions {
  maxCycles?: number;
}

export async function startFollowRunner(alias: string, options: StartRunnerOptions): Promise<Record<string, unknown>> {
  const leader = findLeader(alias);

  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  const profile = loadProfile(leader.alias);
  if (!profile.risk.allow_live) {
    throw new Error("Live execution is disabled in profile. Set risk.allow_live=true to start.");
  }
  if (!process.env.DUOLA_EXECUTION_COMMAND && !process.env.DUOLA_PRIVATE_KEY && !hasPrivateKey(leader.alias)) {
    throw new Error("Store a private key with autopilot onboard, or set DUOLA_PRIVATE_KEY, or set DUOLA_EXECUTION_COMMAND.");
  }

  const db = getDb();
  const runner = db.prepare(`
    SELECT alias, is_running, last_seen_trade_ts, last_sync_ts, cooldown_until_ts, updated_at
    FROM runner_state
    WHERE alias = ?
  `).get(leader.alias) as RunnerState | undefined;

  db.prepare(`
    INSERT INTO runner_state (alias, is_running, last_seen_trade_ts, last_sync_ts, updated_at)
    VALUES (?, 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(alias) DO UPDATE SET
      is_running = 1,
      updated_at = excluded.updated_at
  `).run(leader.alias, runner?.last_seen_trade_ts ?? null);

  let cycle = 0;
  let processedSignals = 0;
  let executedOrders = 0;
  let skippedSignals = 0;

  try {
    while (true) {
      const current = getRunnerState(leader.alias);
      if (!current?.is_running) {
        break;
      }

      const batch = await fetchActivity(leader.address, 20, 0);
      const newTrades = batch
        .filter((item) => item.type === "TRADE" && item.asset)
        .filter((item) => !current?.last_seen_trade_ts || item.timestamp > current.last_seen_trade_ts)
        .sort((left, right) => left.timestamp - right.timestamp);

      if (newTrades.length > 0) {
        const markets = await hydrateMarkets(newTrades.map((item) => item.conditionId));
        for (const trade of newTrades) {
          const outcome = await processTrade(leader.id, trade, markets.get(trade.conditionId), profile);
          processedSignals += 1;
          if (outcome.executed) {
            executedOrders += 1;
          } else {
            skippedSignals += 1;
          }
        }

        const latestTimestamp = newTrades[newTrades.length - 1]?.timestamp ?? current?.last_seen_trade_ts ?? null;
        db.prepare(`
          UPDATE runner_state
          SET last_seen_trade_ts = ?,
              last_sync_ts = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE alias = ?
        `).run(latestTimestamp, leader.alias);
      }

      cycle += 1;
      if (options.maxCycles && cycle >= options.maxCycles) {
        break;
      }

      await sleep(profile.poll_interval_sec * 1000);
    }
  } finally {
    db.prepare(`
      UPDATE runner_state
      SET is_running = 0,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE alias = ?
    `).run(leader.alias);
  }

  return {
    alias: leader.alias,
    mode: "live",
    cycles: cycle,
    processedSignals,
    executedOrders,
    skippedSignals,
    stopped: true
  };
}

export function stopFollowRunner(alias: string): Record<string, unknown> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO runner_state (alias, is_running, updated_at)
    VALUES (?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(alias) DO UPDATE SET
      is_running = 0,
      updated_at = excluded.updated_at
  `).run(leader.alias);

  return {
    alias: leader.alias,
    is_running: false
  };
}

export function getFollowStatus(alias: string): Record<string, unknown> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  const state = getRunnerState(leader.alias);
  return {
    alias: leader.alias,
    is_running: Boolean(state?.is_running),
    last_seen_trade_at: formatTimestamp(state?.last_seen_trade_ts ?? null),
    last_sync_at: state?.last_sync_ts ?? null,
    cooldown_until: formatTimestamp(state?.cooldown_until_ts ?? null),
    updated_at: state?.updated_at ?? null
  };
}

export function getFollowLogs(alias: string, tail: number): Record<string, unknown> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  const db = getDb();
  const signals = db.prepare(`
    SELECT id, source_uid, timestamp, condition_id, asset_id, side, leader_price, requested_usd, status, skip_reason
    FROM signals
    WHERE leader_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(leader.id, tail);

  const orders = db.prepare(`
    SELECT o.id, o.signal_id, o.mode, o.requested_price, o.requested_size, o.filled_price, o.filled_size, o.status, o.error, o.created_at
    FROM orders o
    JOIN signals s ON s.id = o.signal_id
    WHERE s.leader_id = ?
    ORDER BY o.id DESC
    LIMIT ?
  `).all(leader.id, tail);

  return {
    alias: leader.alias,
    signals,
    orders
  };
}

interface RunnerState {
  alias: string;
  is_running: number;
  last_seen_trade_ts: number | null;
  last_sync_ts: string | null;
  cooldown_until_ts: number | null;
  updated_at: string;
}

async function hydrateMarkets(conditionIds: string[]): Promise<Map<string, GammaMarket>> {
  const uniqueIds = [...new Set(conditionIds)];
  const db = getDb();
  const rows = db.prepare(`
    SELECT condition_id, market_json
    FROM market_cache
    WHERE condition_id IN (${uniqueIds.map(() => "?").join(",")})
  `).all(...uniqueIds) as Array<{ condition_id: string; market_json: string }>;

  const marketMap = new Map<string, GammaMarket>();
  for (const row of rows) {
    marketMap.set(row.condition_id, JSON.parse(row.market_json) as GammaMarket);
  }

  const missing = uniqueIds.filter((id) => !marketMap.has(id));
  if (missing.length > 0) {
    const fetched = await fetchMarketsByConditionIds(missing);
    const upsert = db.prepare(`
      INSERT INTO market_cache (condition_id, market_json, fetched_at)
      VALUES (@condition_id, @market_json, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(condition_id) DO UPDATE SET
        market_json = excluded.market_json,
        fetched_at = excluded.fetched_at
    `);

    for (const market of fetched) {
      marketMap.set(market.conditionId, market);
      upsert.run({
        condition_id: market.conditionId,
        market_json: JSON.stringify(market)
      });
    }
  }

  return marketMap;
}

async function processTrade(
  leaderId: number,
  trade: ActivityItem,
  market: GammaMarket | undefined,
  profile: ReturnType<typeof loadProfile>
): Promise<{ executed: boolean }> {
  const db = getDb();
  const sourceUid = buildSourceUid(trade);
  const signalRow = insertSignal(leaderId, trade, sourceUid, profile.sizing.fixed_usd);

  if (!signalRow.inserted) {
    return { executed: false };
  }

  insertLeaderTrade(leaderId, trade, sourceUid);

  const skipReason = determineSkipReason(trade, market, profile);
  if (skipReason) {
    db.prepare(`
      UPDATE signals
      SET status = 'skipped', skip_reason = ?
      WHERE id = ?
    `).run(skipReason, signalRow.signalId);
    return { executed: false };
  }

  const mid = await fetchMidpoint(trade.asset as string).catch(() => null);
  const leaderPrice = trade.price ?? 0;
  if (mid !== null && leaderPrice > 0) {
    const slippageBps = Math.abs(mid - leaderPrice) / leaderPrice * 10000;
    if (slippageBps > profile.execution.max_slippage_bps) {
      db.prepare(`
        UPDATE signals
        SET status = 'skipped', skip_reason = 'price_moved'
        WHERE id = ?
      `).run(signalRow.signalId);
      return { executed: false };
    }
  }

  const requestedPrice = mid ?? leaderPrice;
  const requestedSize = requestedPrice > 0 ? profile.sizing.fixed_usd / requestedPrice : 0;

  try {
    const execution = await executeLiveOrder({
      leaderAlias: profile.leader.alias,
      sourceUid,
      conditionId: trade.conditionId,
      assetId: trade.asset as string,
      side: (trade.side ?? "BUY").toUpperCase(),
      requestedUsd: profile.sizing.fixed_usd,
      requestedPrice,
      requestedSize,
      maxSlippageBps: profile.execution.max_slippage_bps,
      tickSize: market?.orderPriceMinTickSize,
      negRisk: market?.negRisk
    });

    db.prepare(`
      UPDATE signals
      SET status = 'executed'
      WHERE id = ?
    `).run(signalRow.signalId);
    db.prepare(`
      INSERT INTO orders (
        signal_id,
        order_id,
        mode,
        requested_price,
        requested_size,
        filled_price,
        filled_size,
        status,
        error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      signalRow.signalId,
      execution.orderId,
      profile.execution.mode,
      requestedPrice,
      requestedSize,
      execution.filledPrice,
      execution.filledSize,
      execution.status
    );

    return { executed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE signals
      SET status = 'failed', skip_reason = NULL
      WHERE id = ?
    `).run(signalRow.signalId);
    db.prepare(`
      INSERT INTO orders (
        signal_id,
        order_id,
        mode,
        requested_price,
        requested_size,
        filled_price,
        filled_size,
        status,
        error
      ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, 'failed', ?)
    `).run(
      signalRow.signalId,
      profile.execution.mode,
      requestedPrice,
      requestedSize,
      message
    );
    return { executed: false };
  }
}

function insertSignal(leaderId: number, trade: ActivityItem, sourceUid: string, requestedUsd: number): { inserted: boolean; signalId: number } {
  const db = getDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO signals (
      leader_id,
      source_uid,
      timestamp,
      condition_id,
      asset_id,
      side,
      leader_price,
      requested_usd,
      status,
      skip_reason,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?)
  `).run(
    leaderId,
    sourceUid,
    trade.timestamp,
    trade.conditionId,
    trade.asset ?? "",
    trade.side ?? null,
    trade.price ?? null,
    requestedUsd,
    JSON.stringify(trade)
  );

  if (result.changes === 0) {
    const existing = db.prepare(`SELECT id FROM signals WHERE source_uid = ?`).get(sourceUid) as { id: number };
    return { inserted: false, signalId: existing.id };
  }

  return { inserted: true, signalId: Number(result.lastInsertRowid) };
}

function insertLeaderTrade(leaderId: number, trade: ActivityItem, sourceUid: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO leader_trades (
      leader_id,
      source_uid,
      event_type,
      transaction_hash,
      timestamp,
      condition_id,
      asset_id,
      side,
      price,
      size,
      usdc_size,
      title,
      slug,
      outcome,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leaderId,
    sourceUid,
    trade.type,
    trade.transactionHash,
    trade.timestamp,
    trade.conditionId,
    trade.asset ?? "",
    trade.side ?? null,
    trade.price ?? null,
    trade.size ?? null,
    trade.usdcSize ?? null,
    trade.title ?? null,
    trade.slug ?? null,
    trade.outcome ?? null,
    JSON.stringify(trade)
  );
}

function determineSkipReason(
  trade: ActivityItem,
  market: GammaMarket | undefined,
  profile: ReturnType<typeof loadProfile>
): string | null {
  if (!market) {
    return "missing_market";
  }

  if ((market.liquidityNum ?? 0) < profile.filters.min_liquidity_usd) {
    return "low_liquidity";
  }

  const labels = [
    market.category ?? "",
    market.slug ?? "",
    market.events?.[0]?.series?.slug ?? ""
  ].map((value) => value.toLowerCase());

  if (profile.filters.categories_allow.length > 0) {
    const allowed = profile.filters.categories_allow.some((needle) =>
      labels.some((label) => label.includes(needle.toLowerCase()))
    );
    if (!allowed) {
      return "filtered_allow";
    }
  }

  if (profile.filters.categories_deny.length > 0) {
    const denied = profile.filters.categories_deny.some((needle) =>
      labels.some((label) => label.includes(needle.toLowerCase()))
    );
    if (denied) {
      return "filtered_deny";
    }
  }

  if (market.endDate) {
    const expiryMs = Date.parse(market.endDate);
    const tradeMs = trade.timestamp > 10_000_000_000 ? trade.timestamp : trade.timestamp * 1000;
    if (Number.isFinite(expiryMs) && expiryMs - tradeMs < profile.filters.min_time_to_expiry_sec * 1000) {
      return "near_expiry";
    }
  }

  return null;
}

function getRunnerState(alias: string): RunnerState | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT alias, is_running, last_seen_trade_ts, last_sync_ts, cooldown_until_ts, updated_at
    FROM runner_state
    WHERE alias = ?
  `).get(alias) as RunnerState | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
