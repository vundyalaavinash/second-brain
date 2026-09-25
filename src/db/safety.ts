import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { backupsDir } from "@/lib/paths";
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
 * It never reads `file` in place: it copies it, and any -wal beside it, into a throwaway
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
 *
 * The copy does not include -shm: SQLite rebuilds it from -wal on open, so copying it too would
 * only add a third file that can disagree with the other two -- the one piece capable of causing
 * a false failure, never a real one, since nothing here is ever written back to `file`. Measured
 * across repeated verifies of a large database under continuous concurrent writes with no -shm
 * copy: no false failures.
 */
export function verifyDatabaseFile(file: string): CheckResult {
  let tmp: string | undefined;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-verify-"));
    const copy = path.join(tmp, path.basename(file));
    fs.copyFileSync(file, copy);
    const wal = `${file}-wal`;
    if (fs.existsSync(wal)) fs.copyFileSync(wal, `${copy}-wal`);

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
 * straight into a new file. An earlier version instead ran `wal_checkpoint(TRUNCATE)` on the
 * source and ignored its return value; measured, a concurrent reader can make that checkpoint
 * only partially complete, so the plain file copy that followed silently held a fraction of the
 * database while still reporting a sound backup. `VACUUM INTO` has no such partial state to
 * ignore: it throws in that same situation (surfaced to the caller, who is expected to log and
 * carry on rather than let a failed snapshot block opening the database) instead of quietly
 * producing a lie. `VACUUM INTO` itself writes only to the destination -- but opening `file` at
 * all, even to read it, opens it read-write, and closing that connection checkpoints its WAL into
 * the main file and removes the sidecars (measured: no rows lost, and `openDatabase` reopens it
 * read-write a moment later regardless), so this is not a function that touches nothing of `file`.
 *
 * This schema has vec0 virtual tables and FTS5 triggers, and a bare `VACUUM INTO`/`sqlite3` copy
 * of a database with virtual tables has bitten this project before, when a column drop rewrote a
 * table a trigger pointed at. That failure mode does not apply here: `VACUUM INTO` copies
 * `CREATE VIRTUAL TABLE`/trigger definitions as schema text and never executes them, so it does
 * not need the extension loaded to produce a byte-equivalent-quality copy -- measured against a
 * database with three vec0 chunk rows and FTS5 rows after deletion churn, with FTS `MATCH` results,
 * vec0 KNN rowids and distances (to six decimal places), and every shadow-table rowid identical
 * between source and copy, run both with and without sqlite-vec loaded on the copying connection.
 * Do not "fix" this by loading sqlite-vec before the `VACUUM INTO` -- it was never the problem.
 */
export function snapshotBeforeMigrate(file: string, tag: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(file)) return null;

  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${SNAPSHOT_PREFIX}${tag}-${snapshotStamp(now)}.db`);
  // Vacuum to a temporary name in the same directory first, then rename into place. A rename on
  // the same filesystem is atomic, so a crash or a kill mid-vacuum leaves a `.tmp` file behind
  // instead of something named and shaped like a recovery point -- a killed vacuum was measured
  // to leave a partial `pre-*.db` plus a `-journal` sidecar, which nothing downstream re-checks
  // and the retention prune (matching `brain-*.db` only) would never remove.
  const partial = `${dest}.tmp`;

  const source = new Database(file, { fileMustExist: true });
  try {
    source.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  fs.renameSync(partial, dest);

  return keepIfSound(dest, tag);
}
