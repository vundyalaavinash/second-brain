import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { backupsDir } from "@/jobs/handlers/backup";
import type { DB } from "./client";

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** Every pre-migration snapshot's file name starts with this; the three-tier prune must never match it. */
export const SNAPSHOT_PREFIX = "pre-";

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
 * Checks `file` -- a backup you have not opened is a rumour, so this is what proves one is real.
 * It never reads `file` in place: it copies it, and any -wal/-shm beside it, into a throwaway
 * `mkdtemp` directory and checks the copy there. That is the only way to answer honestly, because
 * opening a WAL-mode file read-only makes SQLite create -wal/-shm files of its own for locking
 * bookkeeping (measured; a genuine better-sqlite3 quirk), and a read-only connection has no write
 * access to clean them up on close -- they are left behind. An earlier version of this function
 * tried to clean those up itself by deleting whatever sidecars did not exist before the call
 * started, which meant it could delete a real -wal holding rows a concurrent writer had just
 * committed but not yet checkpointed: the whole point of design's "ambiguous restore" warning.
 * Verifying a copy removes that hazard entirely -- nothing in `file`'s own directory is ever
 * written to or unlinked by this function, on any code path, including a read-only volume. The
 * cost is one copy of a two-megabyte file. Any failure -- a missing file, a file that is not a
 * database at all, a truncated copy, a failed pragma -- comes back as a failed check, never a
 * thrown error.
 */
export function verifyDatabaseFile(file: string): CheckResult {
  let tmp: string | undefined;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-verify-"));
    const copy = path.join(tmp, path.basename(file));
    fs.copyFileSync(file, copy);
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${file}${suffix}`;
      if (fs.existsSync(side)) fs.copyFileSync(side, `${copy}${suffix}`);
    }

    const sqlite = new Database(copy, { readonly: true, fileMustExist: true });
    try {
      const problems = pragmaProblems(sqlite);
      sqlite.prepare("SELECT count(*) AS n FROM items").get();
      return { ok: problems.length === 0, problems };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)] };
  } finally {
    try {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of our own throwaway directory; a function documented never to
      // throw cannot let failing to tidy up after itself be the exception that escapes it
    }
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

/** UTC stamp for a snapshot's file name: readable, sortable alongside it, and independent of the
 * machine's own timezone. */
function snapshotStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Verifies a just-written snapshot. A backup that fails its own check is worse than no backup at
 * all, because it is the one you would reach for -- so a failure discards the file and reports
 * loudly, rather than handing back a path that looks fine and is not. */
function keepIfSound(dest: string, tag: string): string | null {
  const check = verifyDatabaseFile(dest);
  if (check.ok) return dest;
  console.error(`[db] pre-migration snapshot of ${tag} failed verification, discarding it: ${check.problems.join("; ")}`);
  fs.rmSync(dest, { force: true });
  return null;
}

/**
 * Copies `file` into the backups directory before a migration touches it, as `pre-<tag>-<stamp>.db`,
 * verifies what it wrote, and answers the path -- or `null` if there was nothing at `file` yet
 * (a first run, with nothing to protect) or the copy failed its own verification.
 *
 * The copy is SQLite's own `VACUUM INTO`: a single statement, on the same connection, that reads
 * a transactionally consistent snapshot of the database -- WAL-resident committed rows included --
 * straight into a new file, and writes nothing at all back to `file`. An earlier version instead
 * ran `wal_checkpoint(TRUNCATE)` on the source and ignored its return value; measured, a
 * concurrent reader can make that checkpoint only partially complete, so the plain file copy that
 * followed silently held a fraction of the database while still reporting a sound backup. This
 * has no such partial state to ignore: it throws in that same situation (surfaced to the caller,
 * who is expected to log and carry on rather than let a failed snapshot block opening the
 * database) instead of quietly producing a lie.
 */
export function snapshotBeforeMigrate(file: string, tag: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(file)) return null;

  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${SNAPSHOT_PREFIX}${tag}-${snapshotStamp(now)}.db`);

  const source = new Database(file, { fileMustExist: true });
  try {
    source.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  return keepIfSound(dest, tag);
}
