import { getDb } from "../db/client.js";
import { findLeader } from "../leaders/service.js";
import { fetchActivity, type ActivityItem } from "../adapters/polymarket/dataApi.js";
import { fetchMarketsByConditionIds } from "../adapters/polymarket/gammaApi.js";
import { buildSourceUid } from "./sourceUid.js";

export interface SyncResult {
  alias: string;
  requested: number;
  fetched: number;
  inserted: number;
  skipped: number;
  marketCacheUpdated: number;
  lastTimestamp: number | null;
}

export async function syncLeader(aliasOrAddress: string, limit: number): Promise<SyncResult> {
  const leader = findLeader(aliasOrAddress);

  if (!leader) {
    throw new Error(`Leader not found: ${aliasOrAddress}`);
  }

  const pageSize = Math.min(limit, 500);
  let offset = 0;
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let lastTimestamp: number | null = null;
  const seenConditionIds = new Set<string>();
  const db = getDb();

  const insertTrade = db.prepare(`
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
    ) VALUES (
      @leader_id,
      @source_uid,
      @event_type,
      @transaction_hash,
      @timestamp,
      @condition_id,
      @asset_id,
      @side,
      @price,
      @size,
      @usdc_size,
      @title,
      @slug,
      @outcome,
      @raw_json
    )
  `);

  while (fetched < limit) {
    const remaining = limit - fetched;
    const batchLimit = Math.min(pageSize, remaining);
    const batch = await fetchActivity(leader.address, batchLimit, offset);

    if (batch.length === 0) {
      break;
    }

    fetched += batch.length;
    offset += batch.length;

    for (const item of batch) {
      lastTimestamp = lastTimestamp === null ? item.timestamp : Math.max(lastTimestamp, item.timestamp);

      if (item.type !== "TRADE" || !item.asset) {
        skipped += 1;
        continue;
      }

      const result = insertTrade.run({
        leader_id: leader.id,
        source_uid: buildSourceUid(item),
        event_type: item.type,
        transaction_hash: item.transactionHash,
        timestamp: item.timestamp,
        condition_id: item.conditionId,
        asset_id: item.asset,
        side: item.side ?? null,
        price: item.price ?? null,
        size: item.size ?? null,
        usdc_size: item.usdcSize ?? null,
        title: item.title ?? null,
        slug: item.slug ?? null,
        outcome: item.outcome ?? null,
        raw_json: JSON.stringify(item)
      });

      if (result.changes > 0) {
        inserted += 1;
        seenConditionIds.add(item.conditionId);
      } else {
        skipped += 1;
      }
    }
  }

  let marketCacheUpdated = 0;
  if (seenConditionIds.size > 0) {
    const markets = await fetchMarketsByConditionIds([...seenConditionIds]);
    const upsertMarket = db.prepare(`
      INSERT INTO market_cache (condition_id, market_json, fetched_at)
      VALUES (@condition_id, @market_json, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(condition_id) DO UPDATE SET
        market_json = excluded.market_json,
        fetched_at = excluded.fetched_at
    `);

    for (const market of markets) {
      upsertMarket.run({
        condition_id: market.conditionId,
        market_json: JSON.stringify(market)
      });
      marketCacheUpdated += 1;
    }
  }

  db.prepare(`
    INSERT INTO runner_state (alias, is_running, last_seen_trade_ts, last_sync_ts, updated_at)
    VALUES (?, 0, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(alias) DO UPDATE SET
      last_seen_trade_ts = excluded.last_seen_trade_ts,
      last_sync_ts = excluded.last_sync_ts,
      updated_at = excluded.updated_at
  `).run(leader.alias, lastTimestamp);

  return {
    alias: leader.alias,
    requested: limit,
    fetched,
    inserted,
    skipped,
    marketCacheUpdated,
    lastTimestamp
  };
}
