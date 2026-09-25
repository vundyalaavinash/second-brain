import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { attachmentsDir, backupsDir, dataDir } from "@/lib/paths";
import { pruneActivity, retentionDays } from "@/domain/activity";
import { verifyDatabaseFile, recordDbCheck, SNAPSHOT_PREFIX } from "@/db/safety";

export { backupsDir };

/** Kept outright, newest first: the most recent seven calendar days of `brain-*.db`. */
export const KEEP_DAILY = 7;
/** Of what daily did not keep, the newest file in each of up to four distinct ISO weeks. */
export const KEEP_WEEKLY = 4;
/** Of what daily and weekly did not keep, the newest file in each of up to six distinct months. */
export const KEEP_MONTHLY = 6;

/** Pre-migration snapshots newer than this are never pruned outright, however many tags shipped. */
const SNAPSHOT_KEEP_MONTHS = 12;
/** However old the database is, the newest this many distinct migration tags always survive. */
const SNAPSHOT_FLOOR = 10;

const ATTACHMENTS_KEEP = 7;
/** Only `brain-*.db` -- never `pre-*.db`. Pre-migration snapshots mark the exact boundary where
 * the shape of the data changed, which a dated backup cannot reconstruct, so they get their own,
 * longer-lived retention (`pruneSnapshots`) and this prune must not be able to see them at all. */
const NAME_RE = /^brain-(\d{4}-\d{2}-\d{2})\.db$/;
const ATTACHMENTS_NAME_RE = /^attachments-.*$/;
/** `pre-<tag>-<stamp>.db`, where `<stamp>` is `snapshotStamp` in `db/safety.ts` (the ISO instant
 * with `:` and `.` replaced by `-`). Anchored so a tag containing a hyphen still parses: the stamp
 * half has a fixed, recognizable shape and nothing else in this design produces one. */
const SNAPSHOT_RE = new RegExp(`^${SNAPSHOT_PREFIX}(.+)-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)\\.db$`);
/** The larger half of a killed `VACUUM INTO`: a `.tmp` that a crash or kill kept from ever being
 * renamed into a real `pre-*.db`. Always debris, never a recovery point. */
const SNAPSHOT_TMP_RE = new RegExp(`^${SNAPSHOT_PREFIX}.+\\.db\\.tmp$`);
/** The only file shapes `sweepSidecars` is permitted to delete a sidecar of: a dated `brain-*.db`
 * backup, or a `pre-*.db` snapshot (including its `.tmp` while a vacuum is mid-flight), followed by
 * one of the three suffixes SQLite itself appends for an interrupted checkpoint or vacuum. Anything
 * else -- `brain-replaced-<stamp>.db-wal` above all, the one file a restore sets aside rather than
 * deletes -- does not match, however its name ends: a database that legitimately carries committed,
 * not-yet-checkpointed rows in a `-wal` is the one file in this directory nobody may touch. */
const SIDECAR_RE = new RegExp(`^(brain-\\d{4}-\\d{2}-\\d{2}\\.db|${SNAPSHOT_PREFIX}.+\\.db(?:\\.tmp)?)-(wal|shm|journal)$`);

/** UTC stamp used in backup file names -- deliberately not local, so the name it produces and the
 * sort order it implies never depend on the machine's own timezone. */
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

/** A regular file only -- never a directory, symlink, or anything else `rmSync({force: true})`
 * would either mishandle or, worse, recurse into without being asked to. */
function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `null` for anything that doesn't match `brain-*.db` or whose embedded date isn't a real
 * calendar date (`brain-2026-99-99.db` matches the digits-only pattern but is not a valid day).
 * Callers drop a `null` from consideration entirely -- never from disk: a name this function
 * cannot date is a name this file is not equipped to judge, and the safe direction is to leave it
 * alone, not to guess. */
function dateOf(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
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

function quarterKey(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** From `entries` (already newest first), adds to `keep` the newest entry in each of up to
 * `limit` distinct buckets named by `keyOf`, and returns the entries not picked -- either an
 * older file in a bucket a newer file already claimed, or a new bucket beyond the limit -- so the
 * next, coarser tier can still consider them. */
function pickNewestPerBucket(entries: string[], keep: Set<string>, limit: number, keyOf: (name: string) => string): string[] {
  const bucketsUsed = new Set<string>();
  const leftover: string[] = [];
  for (const name of entries) {
    const key = keyOf(name);
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
 * this function cannot see them no matter what it keeps or drops (they have their own retention:
 * `pruneSnapshots`). Builds the complete keep set before deleting anything: daily takes the newest
 * `KEEP_DAILY` outright, then weekly and monthly each pick the newest survivor of what the tier
 * before it did not claim, so a file kept by a higher tier is never also counted by a lower one
 * and nothing is removed on the strength of a partial scan. A name this function cannot date
 * (`dateOf` returning `null`) is excluded from the keep-set computation entirely and therefore
 * never appears in the deletion loop either -- it survives by omission, not by a special case.
 */
export function pruneBackups(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const dates = new Map<string, Date>();
  for (const name of fs.readdirSync(dir)) {
    const d = dateOf(name);
    if (d) dates.set(name, d);
  }
  const entries = [...dates.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first

  const keep = new Set<string>(entries.slice(0, KEEP_DAILY));
  const afterDaily = entries.slice(KEEP_DAILY);
  const afterWeekly = pickNewestPerBucket(afterDaily, keep, KEEP_WEEKLY, (name) => weekKey(dates.get(name)!));
  pickNewestPerBucket(afterWeekly, keep, KEEP_MONTHLY, (name) => monthKey(dates.get(name)!));

  for (const name of entries) {
    if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/** Puts back the `:`/`.` that `snapshotStamp` (`db/safety.ts`) removed, so the stamp half of a
 * snapshot's name parses back into the `Date` it was made from. Malformed input answers an
 * invalid `Date`; callers check for that rather than throwing. */
function parseSnapshotStamp(stamp: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : new Date(NaN);
}

/** The oldest surviving `brain-*.db` in `dir`, or `null` when there is none. Read fresh each call
 * (rather than threaded through as a parameter) so `pruneSnapshots` always sees what `pruneBackups`
 * actually left, not what it intended to leave. */
function oldestBrainBackupDate(dir: string): Date | null {
  let oldest: Date | null = null;
  for (const name of fs.readdirSync(dir)) {
    const d = dateOf(name);
    if (d && (!oldest || d < oldest)) oldest = d;
  }
  return oldest;
}

/**
 * Retention for `pre-*.db` migration snapshots, separate from `pruneBackups` because they answer
 * a different question: not "how recent" but "which boundary". Order matters -- each step narrows
 * what the next one has to consider:
 *
 * 1. **One file per migration tag.** A retried or killed migration can leave several
 *    `pre-<tag>-<stamp>.db`; only the newest stamp is the state that migration actually ran
 *    against, so older stamps for the same tag are dropped outright, whatever their age.
 * 2. **Every remaining tag younger than `SNAPSHOT_KEEP_MONTHS` survives outright.**
 * 3. **Beyond that, the newest snapshot per calendar quarter.**
 * 4. **Floor: the newest `SNAPSHOT_FLOOR` tags always survive**, however old, so a machine that
 *    goes quiet for years doesn't lose its most recent boundaries to the age rule above.
 * 5. **Never prune a tag older than the oldest `brain-*.db` `pruneBackups` just left.** Past that
 *    point the snapshot is the only artifact from before that boundary, which is the entire
 *    argument for keeping snapshots at all -- so this overrides 2-4, never the other way around.
 *
 * Also sweeps `pre-*.db.tmp`: a killed `VACUUM INTO` (see `snapshotBeforeMigrate`) leaves one
 * behind, multiple megabytes, and nothing else in this design ever revisits it.
 *
 * Call this after `pruneBackups` has already run on the same `dir` -- step 5 reads what it left.
 */
export function pruneSnapshots(dir: string, now: Date = new Date()): void {
  if (!fs.existsSync(dir)) return;

  for (const name of fs.readdirSync(dir)) {
    if (SNAPSHOT_TMP_RE.test(name)) fs.rmSync(path.join(dir, name), { force: true });
  }

  const namesByTag = new Map<string, string[]>();
  const newestByTag = new Map<string, { name: string; date: Date }>();
  for (const name of fs.readdirSync(dir)) {
    const m = SNAPSHOT_RE.exec(name);
    if (!m) continue;
    const [, tag, stamp] = m;
    const date = parseSnapshotStamp(stamp);
    if (Number.isNaN(date.getTime())) continue; // cannot date it: leave it alone, like `dateOf`

    const names = namesByTag.get(tag) ?? [];
    names.push(name);
    namesByTag.set(tag, names);

    const current = newestByTag.get(tag);
    if (!current || date > current.date) newestByTag.set(tag, { name, date });
  }

  const byTagNewestFirst = [...newestByTag.values()].sort((a, b) => b.date.getTime() - a.date.getTime());

  const keep = new Set<string>();
  for (const s of byTagNewestFirst.slice(0, SNAPSHOT_FLOOR)) keep.add(s.name); // 4: the floor

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SNAPSHOT_KEEP_MONTHS);
  const quarterUsed = new Set<string>();
  for (const s of byTagNewestFirst) {
    if (keep.has(s.name)) continue;
    if (s.date >= cutoff) {
      keep.add(s.name); // 2: within the outright-keep window
      continue;
    }
    const q = quarterKey(s.date); // 3: beyond it, one per quarter
    if (!quarterUsed.has(q)) {
      quarterUsed.add(q);
      keep.add(s.name);
    }
  }

  const oldestBrain = oldestBrainBackupDate(dir);
  if (oldestBrain) {
    for (const s of byTagNewestFirst) {
      if (s.date < oldestBrain) keep.add(s.name); // 5: overrides everything above
    }
  }

  for (const names of namesByTag.values()) {
    for (const name of names) {
      if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

/**
 * Removes every file in `dir` matching `SIDECAR_RE` -- a `-wal`, `-shm`, or `-journal` beside a
 * `brain-*.db` or `pre-*.db(.tmp)` name this job owns, and nothing else, however its name ends.
 * It is one of only two things in this whole design permitted to delete a file it did not write
 * itself, so it refuses outright when `dir` is the data directory rather than the backups
 * directory -- the one place a live database's own `-wal` could otherwise be reached. Builds the
 * complete list of what to delete, and confirms each one is a plain file (never a directory, which
 * `rmSync({force:true})` would otherwise throw `EISDIR` on), before deleting anything. Returns the
 * count removed.
 */
export function sweepSidecars(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  if (path.resolve(dir) === path.resolve(dataDir())) {
    console.error(`[backup] refusing to sweep sidecars in the data directory itself: ${dir}`);
    return 0;
  }
  const toDelete = fs
    .readdirSync(dir)
    .filter((name) => SIDECAR_RE.test(name))
    .map((name) => path.join(dir, name))
    .filter(isRegularFile);
  for (const p of toDelete) fs.rmSync(p, { force: true });
  return toDelete.length;
}

/** Nightly online backup of the open database and the attachments directory.
 *
 * The database backup is verified before the prune or the sidecar sweep touch the directory: a
 * backup you have not opened is a rumour. A file that fails to open, or opens but fails its
 * checks, is deleted on the spot -- it is never pruned into, because a bad file that looks like a
 * backup is worse than a gap, and it is never allowed to trigger a prune of its own, because the
 * older backups are now the only ones that exist. Either way the result is recorded for the status
 * surface, so a run of silent nightly failures is visible somewhere other than a log nobody reads.
 * A failed verification does not cancel the attachments backup or the activity prune below --
 * those are separate artifacts with their own retention, and a bad database copy is not a reason
 * to also lose a night of attachments.
 */
export function createBackupHandler(deps: { db: DB }): JobHandler {
  return async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = backupFilePath();
    await deps.db.$client.backup(file);

    const check = verifyDatabaseFile(file);
    recordDbCheck(check, "backup");
    if (!check.ok) {
      fs.rmSync(file, { force: true });
      console.error(`[backup] verification failed, discarding what was just written: ${check.problems.join("; ")}`);
    } else {
      pruneBackups(dir);
      pruneSnapshots(dir);
      sweepSidecars(dir);
    }

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
