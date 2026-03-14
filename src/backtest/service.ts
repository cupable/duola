import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/client.js";
import { findLeader } from "../leaders/service.js";
import { fetchMidpoint, fetchPriceHistory } from "../adapters/polymarket/clobApi.js";
import { reportsDir, ensureAppDirs } from "../config/paths.js";
import { formatTimestamp, parseLookbackToSeconds } from "../utils/time.js";

interface StoredTrade {
  timestamp: number;
  condition_id: string;
  asset_id: string;
  side: string | null;
  price: number | null;
  size: number | null;
  usdc_size: number | null;
  slug: string | null;
}

interface CachedMarket {
  conditionId: string;
  category?: string;
  slug?: string;
  endDate?: string;
  liquidityNum?: number;
}

export interface BacktestOptions {
  lookback: string;
  fixedUsd: number;
  minLiquidityUsd: number;
  minTimeToExpirySec: number;
  outputFormat: "json" | "table";
}

export interface BacktestReport {
  alias: string;
  generatedAt: string;
  mode: "backtest";
  config: {
    lookback: string;
    fixedUsd: number;
    minLiquidityUsd: number;
    minTimeToExpirySec: number;
  };
  summary: {
    totalSignals: number;
    executedSignals: number;
    skippedSignals: number;
    winRate: number;
    pnlUsd: number;
    avgReturnPct: number;
    maxDrawdownUsd: number;
    firstTradeAt: string | null;
    lastTradeAt: string | null;
  };
  skipReasons: Record<string, number>;
  reportPath: string;
  markdownReportPath: string;
}

export async function runBacktest(aliasOrAddress: string, options: BacktestOptions): Promise<BacktestReport> {
  const leader = findLeader(aliasOrAddress);

  if (!leader) {
    throw new Error(`Leader not found: ${aliasOrAddress}`);
  }

  const db = getDb();
  const lookbackSeconds = parseLookbackToSeconds(options.lookback);
  const since = Math.floor(Date.now() / 1000) - lookbackSeconds;

  const trades = db.prepare(`
    SELECT timestamp, condition_id, asset_id, side, price, size, usdc_size, slug
    FROM leader_trades
    WHERE leader_id = ? AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(leader.id, since) as StoredTrade[];

  if (trades.length === 0) {
    throw new Error(`No synced trades found for ${leader.alias} in lookback window ${options.lookback}`);
  }

  const marketRows = db.prepare(`
    SELECT condition_id, market_json
    FROM market_cache
    WHERE condition_id IN (${trades.map(() => "?").join(",")})
  `).all(...trades.map((trade) => trade.condition_id)) as Array<{
    condition_id: string;
    market_json: string;
  }>;

  const marketMap = new Map<string, CachedMarket>();
  for (const row of marketRows) {
    marketMap.set(row.condition_id, JSON.parse(row.market_json) as CachedMarket);
  }

  const historyMap = new Map<string, Array<{ t: number; p: number }>>();
  const assetIds = [...new Set(trades.map((trade) => trade.asset_id))];

  await Promise.all(assetIds.map(async (assetId) => {
    try {
      const history = await fetchPriceHistory(assetId, "1d", 1440);
      historyMap.set(assetId, history);
    } catch {
      historyMap.set(assetId, []);
    }
  }));

  const skipReasons: Record<string, number> = {};
  let totalSignals = 0;
  let executedSignals = 0;
  let wins = 0;
  let pnl = 0;
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  const returns: number[] = [];

  for (const trade of trades) {
    totalSignals += 1;
    const market = marketMap.get(trade.condition_id);
    const skipReason = determineSkipReason(trade, market, options);

    if (skipReason) {
      skipReasons[skipReason] = (skipReasons[skipReason] ?? 0) + 1;
      continue;
    }

    const entryPrice = trade.price ?? 0;
    if (entryPrice <= 0) {
      skipReasons.invalid_entry_price = (skipReasons.invalid_entry_price ?? 0) + 1;
      continue;
    }

    const budget = clamp(options.fixedUsd, 1, options.fixedUsd);
    const shares = budget / entryPrice;
    const exitPrice = await estimateExitPrice(trade.asset_id, historyMap.get(trade.asset_id) ?? []);
    const tradePnl = shares * (exitPrice - entryPrice);
    const tradeReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    executedSignals += 1;
    pnl += tradePnl;
    returns.push(tradeReturnPct);
    if (tradePnl > 0) {
      wins += 1;
    }

    equity += tradePnl;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
  }

  ensureAppDirs();
  const generatedAt = new Date().toISOString();
  const stamp = Date.now();
  const reportFile = `backtest_${leader.alias}_${stamp}.json`;
  const markdownFile = `backtest_${leader.alias}_${stamp}.md`;
  const reportPath = path.join(reportsDir, reportFile);
  const markdownReportPath = path.join(reportsDir, markdownFile);
  const report: BacktestReport = {
    alias: leader.alias,
    generatedAt,
    mode: "backtest",
    config: {
      lookback: options.lookback,
      fixedUsd: options.fixedUsd,
      minLiquidityUsd: options.minLiquidityUsd,
      minTimeToExpirySec: options.minTimeToExpirySec
    },
    summary: {
      totalSignals,
      executedSignals,
      skippedSignals: totalSignals - executedSignals,
      winRate: executedSignals === 0 ? 0 : (wins / executedSignals) * 100,
      pnlUsd: round2(pnl),
      avgReturnPct: returns.length === 0 ? 0 : round2(returns.reduce((sum, value) => sum + value, 0) / returns.length),
      maxDrawdownUsd: round2(maxDrawdown),
      firstTradeAt: formatTimestamp(trades[0]?.timestamp ?? null),
      lastTradeAt: formatTimestamp(trades[trades.length - 1]?.timestamp ?? null)
    },
    skipReasons,
    reportPath,
    markdownReportPath
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdownReportPath, renderMarkdown(report), "utf8");
  return report;
}

function determineSkipReason(
  trade: StoredTrade,
  market: CachedMarket | undefined,
  options: BacktestOptions
): string | null {
  if (!market) {
    return "missing_market";
  }

  if ((market.liquidityNum ?? 0) < options.minLiquidityUsd) {
    return "low_liquidity";
  }

  if (market.endDate) {
    const expiry = Date.parse(market.endDate);
    const tradeMillis = normalizeTimestamp(trade.timestamp);
    if (Number.isFinite(expiry) && expiry - tradeMillis < options.minTimeToExpirySec * 1000) {
      return "near_expiry";
    }
  }

  return null;
}

async function estimateExitPrice(assetId: string, history: Array<{ t: number; p: number }>): Promise<number> {
  if (history.length > 0) {
    const latest = history[history.length - 1];
    if (typeof latest.p === "number" && Number.isFinite(latest.p)) {
      return latest.p;
    }
  }

  const mid = await fetchMidpoint(assetId).catch(() => null);
  if (mid !== null) {
    return mid;
  }

  return 0.5;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function renderMarkdown(report: BacktestReport): string {
  const skipLines = Object.entries(report.skipReasons)
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `- ${reason}: ${count}`)
    .join("\n");

  return [
    `# Backtest Report: ${report.alias}`,
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Total signals: ${report.summary.totalSignals}`,
    `- Executed signals: ${report.summary.executedSignals}`,
    `- Skipped signals: ${report.summary.skippedSignals}`,
    `- Win rate: ${report.summary.winRate}%`,
    `- PnL (USD): ${report.summary.pnlUsd}`,
    `- Average return (%): ${report.summary.avgReturnPct}`,
    `- Max drawdown (USD): ${report.summary.maxDrawdownUsd}`,
    `- First trade: ${report.summary.firstTradeAt ?? "n/a"}`,
    `- Last trade: ${report.summary.lastTradeAt ?? "n/a"}`,
    "",
    "## Skip Reasons",
    "",
    skipLines || "- none",
    ""
  ].join("\n");
}
