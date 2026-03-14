import Database from "better-sqlite3";
import { dbPath, ensureAppDirs } from "../config/paths.js";
import { schemaStatements } from "./schema.js";

let database: Database.Database | null = null;

export function getDb(): Database.Database {
  if (database) {
    return database;
  }

  ensureAppDirs();
  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");

  for (const statement of schemaStatements) {
    database.exec(statement);
  }

  runMigrations(database);

  return database;
}

function runMigrations(db: Database.Database): void {
  const hasSignals = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'signals'
  `).get() as { name: string } | undefined;

  if (!hasSignals) {
    return;
  }

  const signalColumns = db.prepare(`PRAGMA table_info(signals)`).all() as Array<{ name: string }>;
  const hasEstimatedUsd = signalColumns.some((column) => column.name === "estimated_usd");
  const hasRequestedUsd = signalColumns.some((column) => column.name === "requested_usd");

  if (hasEstimatedUsd && !hasRequestedUsd) {
    db.exec(`ALTER TABLE signals RENAME COLUMN estimated_usd TO requested_usd`);
  }
}
