import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { ensureSearchTables } from "./search-tables";
import { dbPath } from "@/lib/paths";
import { pendingMigrations, snapshotBeforeMigrate, checkOpenDatabase } from "./safety";

function createDrizzle(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export type DB = ReturnType<typeof createDrizzle>;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const folder = path.join(process.cwd(), "drizzle");
  // Only when there is something to apply: this runs on every open, and a snapshot per open
  // would be both slow and pointless. A bad migration is the one moment last night's backup
  // is not good enough, because it costs the day's work.
  const pending = file === ":memory:" ? [] : pendingMigrations(file, folder);
  if (pending.length > 0) {
    // A database we cannot open is worse than one opened without a snapshot, so a failure here
    // -- a full disk, a permissions slip, a locked file -- is logged loudly and never stops the
    // app from opening.
    try {
      const at = snapshotBeforeMigrate(file, pending[0]);
      if (at) console.log(`[db] snapshot before ${pending[0]}: ${at}`);
    } catch (err) {
      console.error(`[db] pre-migration snapshot failed, continuing without one: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqliteVec.load(sqlite);
  const db = createDrizzle(sqlite);
  migrate(db, { migrationsFolder: folder });
  ensureSearchTables(sqlite);
  if (pending.length > 0) {
    const check = checkOpenDatabase(db);
    // A migration that completes and leaves the database unsound is worse than one that
    // fails outright, because it looks like success.
    if (!check.ok) console.error(`[db] integrity check failed after migrating: ${check.problems.join("; ")}`);
  }
  return db;
}

const g = globalThis as unknown as { __sbDb?: DB };

export function getDb(): DB {
  if (!g.__sbDb) g.__sbDb = openDatabase(dbPath());
  return g.__sbDb;
}
