import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { attachmentsDir, backupsDir } from "@/lib/paths";
import { pruneActivity, retentionDays } from "@/domain/activity";
import { verifyDatabaseFile } from "@/db/safety";

export { backupsDir };

/** Kept outright, newest first: the most recent seven calendar days of `brain-*.db`. */
export const KEEP_DAILY = 7;
/** Of what daily did not keep, the newest file in each of up to four distinct ISO weeks. */
export const KEEP_WEEKLY = 4;
/** Of what daily and weekly did not keep, the newest file in each of up to six distinct months. */
export const KEEP_MONTHLY = 6;

const ATTACHMENTS_KEEP = 7;
/** Only `brain-*.db` -- never `pre-*.db`. Pre-migration snapshots mark the exact boundary where
 * the shape of the data changed, which a dated backup cannot reconstruct, so they get their own,
 * longer-lived retention and this prune must not be able to see them at all. */
const NAME_RE = /^brain-(\d{4}-\d{2}-\d{2})\.db$/;
const ATTACHMENTS_NAME_RE = /^attachments-.*$/;
/** The only three suffixes `sweepSidecars` is permitted to touch. Every one of them is evidence
 * of an interrupted checkpoint or vacuum -- nothing in this design leaves one on purpose, because
 * a nightly backup checkpoints the WAL into the main file before it lands, and a vacuum snapshot
 * only ever becomes `pre-*.db` by renaming a finished `.tmp` into place. */
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

/** Local YYYY-MM-DD stamp used in backup file names. */
export function backupDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function backupFilePath(now: Date = new Date()): string {
  return path.join(backupsDir(), `brain-${backupDateStamp(now)}.db`);
}

export function attachmentsBackupPath(now: Date = new Date()): string {
  return path.join(backupsDir(), `attachments-${backupDateStamp(now)}`);
}

/** Keep only the newest `keep` entries matching `re` (by name, which sorts chronologically). */
function pruneOld(dir: string, keep: number, re: RegExp): void {
  const entries = fs
    .readdirSync(dir)
    .filter((name) => re.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest (lexically largest) first
  for (const name of entries.slice(keep)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function dateOf(name: string): Date {
  const m = NAME_RE.exec(name)!;
  return new Date(`${m[1]}T00:00:00.000Z`);
}

/** The Monday (as an ISO date string) that starts the ISO week containing `d`. Grouping by that
 * Monday is exactly ISO-week bucketing without needing week numbers, so it needs no special
 * casing at a year boundary. UTC throughout, so it never depends on the machine's timezone. */
function weekKey(d: Date): string {
  const day = d.getUTCDay() || 7; // Monday=1 ... Sunday=7
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** From `entries` (already newest first), adds to `keep` the newest entry in each of up to
 * `limit` distinct buckets named by `keyOf`, and returns the entries not picked -- either an
 * older file in a bucket a newer file already claimed, or a new bucket beyond the limit -- so the
 * next, coarser tier can still consider them. */
function pickNewestPerBucket(entries: string[], keep: Set<string>, limit: number, keyOf: (d: Date) => string): string[] {
  const bucketsUsed = new Set<string>();
  const leftover: string[] = [];
  for (const name of entries) {
    const key = keyOf(dateOf(name));
    if (!bucketsUsed.has(key) && bucketsUsed.size < limit) {
      bucketsUsed.add(key);
      keep.add(name);
    } else {
      leftover.push(name);
    }
  }
  return leftover;
}

/**
 * Three-tier retention for `brain-*.db` only -- `pre-*.db` snapshots never match `NAME_RE`, so
 * this function cannot see them no matter what it keeps or drops. Builds the complete keep set
 * before deleting anything: daily takes the newest `KEEP_DAILY` outright, then weekly and monthly
 * each pick the newest survivor of what the tier before it did not claim, so a file kept by a
 * higher tier is never also counted by a lower one and nothing is removed on the strength of a
 * partial scan.
 */
export function pruneBackups(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir)
    .filter((name) => NAME_RE.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest (lexically largest) first

  const keep = new Set<string>(entries.slice(0, KEEP_DAILY));
  const afterDaily = entries.slice(KEEP_DAILY);
  const afterWeekly = pickNewestPerBucket(afterDaily, keep, KEEP_WEEKLY, weekKey);
  pickNewestPerBucket(afterWeekly, keep, KEEP_MONTHLY, monthKey);

  for (const name of entries) {
    if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/**
 * Removes any file in `dir` ending in `-wal`, `-shm`, or `-journal` -- the only three suffixes
 * this is ever allowed to touch, and it is one of only two things in this whole design permitted
 * to delete a file it did not write. Builds the complete list of what to delete before deleting
 * anything. Returns the count removed.
 */
export function sweepSidecars(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const toDelete = fs.readdirSync(dir).filter((name) => SIDECAR_SUFFIXES.some((suffix) => name.endsWith(suffix)));
  for (const name of toDelete) fs.rmSync(path.join(dir, name), { force: true });
  return toDelete.length;
}

/** Nightly online backup of the open database and the attachments directory.
 *
 * The database backup is verified before anything else touches the directory: a backup you have
 * not opened is a rumour. A file that fails to open, or opens but fails its checks, is deleted on
 * the spot -- it is never pruned into, because a bad file that looks like a backup is worse than
 * a gap, and it is never allowed to trigger a prune of its own, because the older backups are now
 * the only ones that exist. Only a backup that verified sound reaches the tiered prune and the
 * sidecar sweep.
 */
export function createBackupHandler(deps: { db: DB }): JobHandler {
  return async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = backupFilePath();
    await deps.db.$client.backup(file);

    const check = verifyDatabaseFile(file);
    if (!check.ok) {
      fs.rmSync(file, { force: true });
      console.error(`[backup] verification failed, discarding what was just written: ${check.problems.join("; ")}`);
      return;
    }

    pruneBackups(dir);
    sweepSidecars(dir);

    const attSrc = attachmentsDir();
    if (fs.existsSync(attSrc)) {
      const dest = attachmentsBackupPath();
      // Remove any existing same-day backup first so files deleted since are not left behind by cpSync's merge.
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(attSrc, dest, { recursive: true });
    }
    pruneOld(dir, ATTACHMENTS_KEEP, ATTACHMENTS_NAME_RE);

    const pruned = pruneActivity(deps.db, retentionDays(deps.db));
    if (pruned.sessions || pruned.events) console.log(`[backup] pruned ${pruned.sessions} activity session(s), ${pruned.events} event(s)`);
  };
}
