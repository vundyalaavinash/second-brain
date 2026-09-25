import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "@/lib/paths";
import type { DB } from "./client";

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** Every pre-migration snapshot's file name starts with this; the three-tier prune must never match it. */
export const SNAPSHOT_PREFIX = "pre-";

function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

/** `integrity_check` and `foreign_key_check` against an already-open connection, in one place so
 * `verifyDatabaseFile` and `checkOpenDatabase` can't drift apart on what "sound" means. */
function pragmaProblems(sqlite: Database.Database): string[] {
  const problems: string[] = [];
  const integrity = sqlite.pragma("integrity_check") as Array<Record<string, unknown>>;
  for (const row of integrity) {
    const value = Object.values(row)[0];
    if (value !== "ok") problems.push(String(value));
  }
  const violations = sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) problems.push(`${violations.length} foreign key violation(s)`);
  return problems;
}

/**
 * Opens `file` read-only and checks it. A backup you have not opened is a rumour, so this is
 * what proves one is real, and it opens read-only so that checking a backup can never be the
 * thing that leaves a stale -wal beside it. Any failure -- a missing file, a file that is not a
 * database at all, a truncated copy, a failed pragma -- comes back as a failed check, never a
 * thrown error.
 *
 * A read-only open of a WAL-mode file that has no -wal/-shm yet still makes SQLite create them,
 * purely for its own locking bookkeeping -- a genuine better-sqlite3/SQLite quirk, and the exact
 * mechanism that left the stray sidecars already on disk. Because this connection never writes,
 * anything it creates holds no data of ours, so any sidecar that did not exist before this call
 * is removed after closing; one that already existed (a real, possibly-uncheckpointed backup) is
 * never touched, so a directory that had sidecars keeps exactly the ones it had.
 */
export function verifyDatabaseFile(file: string): CheckResult {
  const walFile = `${file}-wal`;
  const shmFile = `${file}-shm`;
  const hadWal = fs.existsSync(walFile);
  const hadShm = fs.existsSync(shmFile);
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true });
    const problems = pragmaProblems(sqlite);
    sqlite.prepare("SELECT count(*) AS n FROM items").get();
    return { ok: problems.length === 0, problems };
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  } finally {
    try {
      sqlite?.close();
    } catch {
      // already closed or never opened; nothing to do
    }
    if (!hadWal && fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
    if (!hadShm && fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
  }
}

/** The same two pragmas, against a connection that is already open. */
export function checkOpenDatabase(db: DB): CheckResult {
  try {
    const problems = pragmaProblems(db.$client);
    return { ok: problems.length === 0, problems };
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  }
}

interface JournalEntry {
  tag: string;
  when: number;
}

/** The migration tags in the journal that `file` has not applied yet, oldest first. When the
 * migrations table does not exist at all, everything is pending. */
export function pendingMigrations(file: string, folder: string): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = [...journal.entries].sort((a, b) => a.when - b.when);
  if (!fs.existsSync(file)) return entries.map((e) => e.tag);

  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const table = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get();
    if (!table) return entries.map((e) => e.tag);
    const row = sqlite.prepare("SELECT MAX(created_at) AS appliedThrough FROM __drizzle_migrations").get() as {
      appliedThrough: number | null;
    };
    const appliedThrough = row.appliedThrough ?? 0;
    return entries.filter((e) => e.when > appliedThrough).map((e) => e.tag);
  } finally {
    sqlite.close();
  }
}

/** Local timestamp stamp for a snapshot's file name: readable, and sortable alongside it. */
function snapshotStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Copies `file` into the backups directory before a migration touches it, checkpointing the
 * write-ahead log into the main file first so the copy is one self-contained database with no
 * sidecars -- the same property a nightly backup has, for the same reason. Verifies what it
 * wrote and logs loudly if that fails, but still answers the path: the point is a database that
 * is about to be migrated, not one already proven perfect. Answers `null` when there is nothing
 * at `file` yet, which is a first run and has nothing to protect.
 */
export function snapshotBeforeMigrate(file: string, tag: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(file)) return null;

  const source = new Database(file);
  try {
    source.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    source.close();
  }

  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${SNAPSHOT_PREFIX}${tag}-${snapshotStamp(now)}.db`);
  fs.copyFileSync(file, dest);

  const check = verifyDatabaseFile(dest);
  if (!check.ok) console.error(`[db] pre-migration snapshot failed verification: ${check.problems.join("; ")}`);
  return dest;
}
