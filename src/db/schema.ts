export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS leaders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL UNIQUE,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS leader_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leader_id INTEGER NOT NULL,
    source_uid TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    condition_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    side TEXT,
    price REAL,
    size REAL,
    usdc_size REAL,
    title TEXT,
    slug TEXT,
    outcome TEXT,
    raw_json TEXT NOT NULL,
    FOREIGN KEY (leader_id) REFERENCES leaders(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leader_trades_leader_ts
    ON leader_trades (leader_id, timestamp DESC)`,
  `CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leader_id INTEGER NOT NULL,
    source_uid TEXT NOT NULL UNIQUE,
    timestamp INTEGER NOT NULL,
    condition_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    side TEXT,
    leader_price REAL,
    requested_usd REAL,
    status TEXT NOT NULL,
    skip_reason TEXT,
    raw_json TEXT NOT NULL,
    FOREIGN KEY (leader_id) REFERENCES leaders(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_signals_leader_ts
    ON signals (leader_id, timestamp DESC)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    order_id TEXT,
    mode TEXT NOT NULL,
    requested_price REAL,
    requested_size REAL,
    filled_price REAL,
    filled_size REAL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (signal_id) REFERENCES signals(id)
  )`,
  `CREATE TABLE IF NOT EXISTS market_cache (
    condition_id TEXT PRIMARY KEY,
    market_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    mid REAL,
    best_bid REAL,
    best_ask REAL,
    raw_json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_price_snapshots_asset_ts
    ON price_snapshots (asset_id, ts DESC)`,
  `CREATE TABLE IF NOT EXISTS profiles (
    alias TEXT PRIMARY KEY,
    profile_path TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS runner_state (
    alias TEXT PRIMARY KEY,
    is_running INTEGER NOT NULL DEFAULT 0,
    last_seen_trade_ts INTEGER,
    last_sync_ts TEXT,
    cooldown_until_ts INTEGER,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`
];
