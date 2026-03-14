import { getDb } from "../db/client.js";

export interface LeaderRecord {
  id: number;
  alias: string;
  address: string;
  notes: string | null;
  created_at: string;
}

export function addLeader(alias: string, address: string, notes?: string): LeaderRecord {
  const db = getDb();
  const statement = db.prepare(`
    INSERT INTO leaders (alias, address, notes)
    VALUES (@alias, @address, @notes)
    RETURNING id, alias, address, notes, created_at
  `);

  return statement.get({
    alias,
    address: address.toLowerCase(),
    notes: notes ?? null
  }) as LeaderRecord;
}

export function listLeaders(): LeaderRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, alias, address, notes, created_at
    FROM leaders
    ORDER BY created_at ASC
  `).all() as LeaderRecord[];
}

export function removeLeader(aliasOrAddress: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM leaders
    WHERE alias = ? OR address = ?
  `).run(aliasOrAddress, aliasOrAddress.toLowerCase());

  return result.changes > 0;
}

export function findLeader(aliasOrAddress: string): LeaderRecord | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT id, alias, address, notes, created_at
    FROM leaders
    WHERE alias = ? OR address = ?
    LIMIT 1
  `).get(aliasOrAddress, aliasOrAddress.toLowerCase()) as LeaderRecord | undefined;
}

export function inspectLeader(aliasOrAddress: string): Record<string, unknown> {
  const db = getDb();
  const leader = findLeader(aliasOrAddress);

  if (!leader) {
    throw new Error(`Leader not found: ${aliasOrAddress}`);
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS trade_count,
      MIN(timestamp) AS first_trade_ts,
      MAX(timestamp) AS last_trade_ts,
      AVG(COALESCE(usdc_size, 0)) AS avg_usdc_size
    FROM leader_trades
    WHERE leader_id = ?
  `).get(leader.id) as {
    trade_count: number;
    first_trade_ts: number | null;
    last_trade_ts: number | null;
    avg_usdc_size: number | null;
  };

  const topMarkets = db.prepare(`
    SELECT slug, COUNT(*) AS count
    FROM leader_trades
    WHERE leader_id = ?
    GROUP BY slug
    ORDER BY count DESC, slug ASC
    LIMIT 5
  `).all(leader.id) as Array<{ slug: string | null; count: number }>;

  const recentConditions = db.prepare(`
    SELECT DISTINCT condition_id
    FROM leader_trades
    WHERE leader_id = ?
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(leader.id) as Array<{ condition_id: string }>;

  const categoryCounts = new Map<string, number>();
  if (recentConditions.length > 0) {
    const rows = db.prepare(`
      SELECT condition_id, market_json
      FROM market_cache
      WHERE condition_id IN (${recentConditions.map(() => "?").join(",")})
    `).all(...recentConditions.map((row) => row.condition_id)) as Array<{
      condition_id: string;
      market_json: string;
    }>;

    for (const row of rows) {
      const market = JSON.parse(row.market_json) as { category?: string };
      const category = market.category ?? "unknown";
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const categories = [...categoryCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => ({ category, count }));

  return {
    leader,
    stats,
    topMarkets,
    categories
  };
}
