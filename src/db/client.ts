import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { ensureSearchTables } from "./search-tables";
import { dbPath } from "@/lib/paths";

function createDrizzle(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export type DB = ReturnType<typeof createDrizzle>;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqliteVec.load(sqlite);
  const db = createDrizzle(sqlite);
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  ensureSearchTables(sqlite);
  return db;
}

const g = globalThis as unknown as { __sbDb?: DB };

export function getDb(): DB {
  if (!g.__sbDb) g.__sbDb = openDatabase(dbPath());
  return g.__sbDb;
}
