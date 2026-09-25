import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { backupsDir } from "@/lib/paths";
import { EMBEDDING_DIMENSIONS } from "@/providers/embed/types";
import type { DB } from "./client";

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** Every pre-migration snapshot's file name starts with this; the three-tier prune must never match it. */
export const SNAPSHOT_PREFIX = "pre-";

export interface DbCheckStatus extends CheckResult {
  checkedAt: string;
  /** Which check produced this: boot's own periodic check, or the nightly backup's post-write
   * verification. Both write through `recordDbCheck`, so whichever ran most recently is what the
   * status surface shows -- the two can never disagree about the same database, because there is
   * only ever one recorded result. */
  source: "boot" | "backup";
}

const statusGlobal = globalThis as unknown as { __sbDbCheck?: DbCheckStatus };

/**
 * Records the most recent integrity/search check for design §7's status surface. A verification
 * failure that is only a `console.error` is invisible to anything but a log nobody reads -- and a
 * boot check that never learns what the backup job just found can report "passed" the same night
 * every backup silently fails and is deleted, which is worse than either failure alone. Both
 * `checkDatabaseOnBoot` and the backup handler call this, through the same function, so there is
 * one shared answer to "is this database sound" rather than two that can drift apart.
 */
export function recordDbCheck(check: CheckResult, source: DbCheckStatus["source"], now: Date = new Date()): DbCheckStatus {
  const status: DbCheckStatus = { ...check, checkedAt: now.toISOString(), source };
  statusGlobal.__sbDbCheck = status;
  return status;
}

/** The most recently recorded check, from either boot or the backup job. `undefined` before either
 * has run in this process. */
export function getLastDbCheck(): DbCheckStatus | undefined {
  return statusGlobal.__sbDbCheck;
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

/** A real, tokenizable term pulled from actual chunk text, so the FTS probe below proves the
 * index returns results for what this database genuinely contains rather than for a fixed guess
 * that might not appear in it at all. `null` when nothing tokenizable was found in the rows
 * looked at, which is not itself treated as a failure -- see `virtualTableProblems`. */
function firstSearchableTerm(sqlite: Database.Database): string | null {
  const rows = sqlite.prepare("SELECT text FROM chunks LIMIT 50").all() as { text: string }[];
  for (const row of rows) {
    const m = /[\p{L}\p{N}]{2,}/u.exec(row.text ?? "");
    if (m) return m[0].toLowerCase();
  }
  return null;
}

/**
 * Confirms `chunks_fts` and `chunks_vec` -- the FTS5 and vec0 virtual tables search runs against
 * -- do not merely exist but actually answer the queries search runs. `pragmaProblems` proves the
 * pages are intact; it opens its connection without sqlite-vec loaded, so it cannot see a damaged
 * vec0 shadow table, and `integrity_check` does not walk FTS5's shadow tables either. A first
 * version of this function stopped at `count(*)` on each table, which does not detect a damaged
 * index at all: `chunks_fts` is an external-content table (`content='chunks'`), so `count(*)`
 * reads the content table `chunks`, not the index -- measured, 7 rows against 0 real `MATCH`
 * hits with the index emptied -- and a `chunks_vec` whose shadow vectors were zeroed still
 * answered `count(*)` while returning null distances and wrong rowids from a real KNN query.
 *
 * The two probes are gated independently, on `chunks` and `chunks_vec` each having rows of their
 * own -- not on `chunks` alone. `chunks_fts` is populated by the same trigger that inserts the
 * `chunks` row, so "chunks has rows" and "the FTS index has rows" really do rise together. But
 * `chunks_vec` is populated later, by the separate, asynchronous embed job -- so a database can
 * have chunks and zero vectors under `SB_EMBED=off` (an explicitly supported mode), after any
 * embed-provider failure, or simply during the ordinary window between ingesting something and
 * that job running. A single `chunks`-only gate made that permanent state fail the vector probe:
 * every nightly backup would verify unsound, be deleted, forever, on a database with nothing
 * wrong with it at all -- the owner's first capture would have armed it. There is nothing to
 * search when a given index has no rows of its own, which is the owner's actual state much of the
 * time, and a false failure there would be worse than the gap it would create -- so each probe
 * only runs once its own table has rows, and an empty result from either is a failure only then.
 */
function virtualTableProblems(sqlite: Database.Database): string[] {
  const problems: string[] = [];

  let chunkCount: number;
  try {
    chunkCount = (sqlite.prepare("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
  } catch (err) {
    problems.push(`chunks unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return problems; // nothing to gate either probe on
  }

  if (chunkCount > 0) {
    try {
      const term = firstSearchableTerm(sqlite);
      if (term) {
        const hit = sqlite.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 1").get(`${term}*`);
        if (!hit) problems.push(`chunks_fts: MATCH for "${term}" (present in the data) returned nothing`);
      }
    } catch (err) {
      problems.push(`chunks_fts unqueryable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let vectorCount: number;
  try {
    sqliteVec.load(sqlite);
    vectorCount = (sqlite.prepare("SELECT count(*) AS n FROM chunks_vec").get() as { n: number }).n;
  } catch (err) {
    problems.push(`chunks_vec unqueryable: ${err instanceof Error ? err.message : String(err)}`);
    return problems; // the table itself could not even be counted
  }

  if (vectorCount > 0) {
    try {
      // A unit vector, not all-zero: this schema's distance metric is cosine, which is undefined
      // for a zero-magnitude query vector (measured -- a zero vector returns a null distance
      // against a perfectly healthy index, which would make this probe lie in the other direction).
      const probe = new Float32Array(EMBEDDING_DIMENSIONS);
      probe[0] = 1;
      const probeBlob = Buffer.from(probe.buffer, probe.byteOffset, probe.byteLength);
      const hit = sqlite.prepare("SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1").get(probeBlob) as
        | { rowid: number; distance: number | null }
        | undefined;
      if (!hit || hit.distance === null || hit.distance === undefined) {
        problems.push("chunks_vec: nearest-neighbour query returned no usable result");
      }
    } catch (err) {
      problems.push(`chunks_vec unqueryable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
 *
 * "Sound" means the search still works, not merely that the pages are intact: the copy is opened
 * with sqlite-vec loaded and `chunks_fts`/`chunks_vec` are queried directly (see
 * `virtualTableProblems`), because `integrity_check` alone cannot speak for a vector index it
 * never walks, and an unextended connection cannot even query a vec0 table to find out.
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
      const problems = [...pragmaProblems(sqlite), ...virtualTableProblems(sqlite)];
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

/** The same pragmas and virtual-table probes `verifyDatabaseFile` runs, against a connection that
 * is already open, so boot's own check covers exactly what the backup job's does and the two
 * cannot disagree about the same database. Loading sqlite-vec again here is safe: `openDatabase`
 * already loaded it once for this connection, and a second `sqliteVec.load` on the same connection
 * is a no-op (measured; does not throw). */
export function checkOpenDatabase(db: DB): CheckResult {
  try {
    const problems = [...pragmaProblems(db.$client), ...virtualTableProblems(db.$client)];
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
