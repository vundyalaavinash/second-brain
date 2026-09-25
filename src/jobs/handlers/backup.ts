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
/** A `.tmp` has to be at least this old before `pruneSnapshots` will touch it -- a real
 * `VACUUM INTO` on this database finishes in a fraction of a second, so an hour is a wide margin
 * against unlinking one another process still has in flight. */
const SNAPSHOT_TMP_MIN_AGE_MS = 60 * 60 * 1000;

const ATTACHMENTS_KEEP = 7;
/** Only `brain-*.db` -- never `pre-*.db`. Pre-migration snapshots mark the exact boundary where
 * the shape of the data changed, which a dated backup cannot reconstruct, so they get their own,
 * longer-lived retention (`pruneSnapshots`) and this prune must not be able to see them at all. */
const NAME_RE = /^brain-(\d{4}-\d{2}-\d{2})\.db$/;
/** Anchored to exactly `attachments-<date>` -- the shape `attachmentsBackupPath` writes -- not
 * `^attachments-.*$`, which also matched `attachments-replaced-<stamp>` (what Task 3's restore
 * moves the live attachments aside to before installing a dated backup). That name sorts *above*
 * every real dated name (`r` > any digit), so the old, loose pattern treated every replaced
 * directory as the newest attachments backup and pruned every genuine one out from under it --
 * reproduced: eight replaced directories and three genuine ones in, seven of the eight replaced
 * ones survived and all three genuine ones, including the one this same run had just written,
 * were deleted. Restore now writes replaced attachments under the data directory, not here, so
 * this alone already closes that path -- this anchor is the second, independent half: whatever
 * name a future writer invents for something that is not a dated backup, this can't mistake it
 * for one just because it starts with "attachments-". */
const ATTACHMENTS_NAME_RE = /^attachments-\d{4}-\d{2}-\d{2}$/;
/** `pre-<tag>-<stamp>.db`, where `<stamp>` is `snapshotStamp` in `db/safety.ts` (the ISO instant
 * with `:` and `.` replaced by `-`). Anchored so a tag containing a hyphen still parses: the stamp
 * half has a fixed, recognizable shape and nothing else in this design produces one. */
const SNAPSHOT_RE = new RegExp(`^${SNAPSHOT_PREFIX}(.+)-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)\\.db$`);
/** The larger half of a killed `VACUUM INTO`: a `.tmp` that a crash or kill kept from ever being
 * renamed into a real `pre-*.db`. Always debris (once old enough -- see `SNAPSHOT_TMP_MIN_AGE_MS`),
 * never a recovery point. */
const SNAPSHOT_TMP_RE = new RegExp(`^${SNAPSHOT_PREFIX}.+\\.db\\.tmp$`);
/** A sidecar's suffix alone, with its base name captured separately so `ownedSidecarBase` can
 * decide, using the exact same rules `pruneBackups` and `pruneSnapshots` use, whether that base is
 * a name this job actually owns -- rather than a second pattern that could quietly drift from the
 * first and, say, agree to sweep `brain-9999-99-99.db-wal` although `dateOf` would never treat
 * `brain-9999-99-99.db` itself as a real backup. */
const SIDECAR_SUFFIX_RE = /^(.+)-(wal|shm|journal)$/;

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

/** A regular file only -- never a directory, and never a symlink either way it might resolve.
 * Uses `lstatSync`, not `statSync`: `statSync` follows a symlink and reports on whatever it points
 * to, which would call a symlink to a file "a regular file" and let it through -- true of the
 * link's target, not of the link itself, and this function exists to decide what counts as a
 * backup or sidecar this job owns, which a symlink never is, whatever it happens to point to. */
function isRegularFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
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
    const p = path.join(dir, name);
    if (!keep.has(name) && isRegularFile(p)) fs.rmSync(p, { force: true });
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

interface SnapshotEntry {
  name: string;
  date: Date;
}

interface TagGroup {
  tag: string;
  /** The tag's newest stamp -- what every age-based rule (2-5) keys off, since that is when the
   * migration this tag names actually took effect. */
  newestDate: Date;
  /** At most two names: the oldest and newest stamp for this tag, or one name if there was only
   * ever one. Kept or dropped together -- see rule 1's doc below. */
  keepCandidates: Set<string>;
}

/**
 * Retention for `pre-*.db` migration snapshots, separate from `pruneBackups` because they answer
 * a different question: not "how recent" but "which boundary". Order matters -- each step narrows
 * what the next one has to consider:
 *
 * 1. **At most two files per migration tag: the oldest and the newest stamp.** A tag only gets
 *    snapshotted more than once when a migration was attempted and did not stick -- and in that
 *    case the *oldest* stamp is the valuable one, the true pre-first-attempt state, while the
 *    newest may be a half-applied database. An earlier version of this rule kept only the newest,
 *    which is backwards for exactly the case it exists to handle. Any stamp strictly between the
 *    two (a second or third retry) is genuinely redundant and is dropped regardless of age.
 * 2. **Every remaining tag younger than `SNAPSHOT_KEEP_MONTHS` survives outright** (both its files).
 * 3. **Beyond that, the newest snapshot per calendar quarter** (both its files).
 * 4. **Floor: the newest `SNAPSHOT_FLOOR` tags always survive**, however old, so a machine that
 *    goes quiet for years doesn't lose its most recent boundaries to the age rule above.
 * 5. **Never prune a tag older than the oldest `brain-*.db` `pruneBackups` just left.** Past that
 *    point the snapshot is the only artifact from before that boundary, which is the entire
 *    argument for keeping snapshots at all -- so this overrides 2-4, never the other way around.
 *
 * Rule 5 makes 2-4 rarely the deciding factor in practice, which is fine: tens of files at roughly
 * two megabytes each is not a disk problem.
 *
 * Also sweeps `pre-*.db.tmp` older than `SNAPSHOT_TMP_MIN_AGE_MS`: a killed `VACUUM INTO` (see
 * `snapshotBeforeMigrate`) leaves one behind, multiple megabytes, and nothing else in this design
 * ever revisits it. The age floor exists because a `.tmp` younger than that might not be debris at
 * all -- it might be another process's vacuum still in flight.
 *
 * Call this after `pruneBackups` has already run on the same `dir` -- step 5 reads what it left.
 */
export function pruneSnapshots(dir: string, now: Date = new Date()): void {
  if (!fs.existsSync(dir)) return;

  for (const name of fs.readdirSync(dir)) {
    if (!SNAPSHOT_TMP_RE.test(name)) continue;
    const p = path.join(dir, name);
    if (!isRegularFile(p)) continue;
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(p).mtimeMs;
    } catch {
      continue; // vanished between readdir and stat -- nothing left to sweep
    }
    if (now.getTime() - mtimeMs >= SNAPSHOT_TMP_MIN_AGE_MS) fs.rmSync(p, { force: true });
  }

  const entriesByTag = new Map<string, SnapshotEntry[]>();
  for (const name of fs.readdirSync(dir)) {
    const m = SNAPSHOT_RE.exec(name);
    if (!m) continue;
    const [, tag, stamp] = m;
    const date = parseSnapshotStamp(stamp);
    if (Number.isNaN(date.getTime())) continue; // cannot date it: leave it alone, like `dateOf`
    const list = entriesByTag.get(tag) ?? [];
    list.push({ name, date });
    entriesByTag.set(tag, list);
  }

  const groups: TagGroup[] = [];
  for (const [tag, entries] of entriesByTag) {
    entries.sort((a, b) => a.date.getTime() - b.date.getTime()); // oldest first
    const oldest = entries[0];
    const newest = entries[entries.length - 1]; // same element when there is only one
    groups.push({ tag, newestDate: newest.date, keepCandidates: new Set([oldest.name, newest.name]) }); // 1
  }
  const byTagNewestFirst = groups.sort((a, b) => b.newestDate.getTime() - a.newestDate.getTime());

  const keptTags = new Set<string>();
  const keep = new Set<string>();
  const keepGroup = (g: TagGroup): void => {
    if (keptTags.has(g.tag)) return;
    keptTags.add(g.tag);
    for (const name of g.keepCandidates) keep.add(name);
  };

  for (const g of byTagNewestFirst.slice(0, SNAPSHOT_FLOOR)) keepGroup(g); // 4: the floor

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SNAPSHOT_KEEP_MONTHS);
  const quarterUsed = new Set<string>();
  for (const g of byTagNewestFirst) {
    if (keptTags.has(g.tag)) continue;
    if (g.newestDate >= cutoff) {
      keepGroup(g); // 2: within the outright-keep window
      continue;
    }
    const q = quarterKey(g.newestDate); // 3: beyond it, one tag per quarter
    if (!quarterUsed.has(q)) {
      quarterUsed.add(q);
      keepGroup(g);
    }
  }

  const oldestBrain = oldestBrainBackupDate(dir);
  if (oldestBrain) {
    for (const g of byTagNewestFirst) {
      if (g.newestDate < oldestBrain) keepGroup(g); // 5: overrides everything above
    }
  }

  for (const entries of entriesByTag.values()) {
    for (const { name } of entries) {
      const p = path.join(dir, name);
      if (!keep.has(name) && isRegularFile(p)) fs.rmSync(p, { force: true });
    }
  }
}

/** Whether `base` -- the part of a sidecar's name before its `-wal`/`-shm`/`-journal` suffix -- is
 * a name this job actually owns. Shares the exact validity rules `pruneBackups` and
 * `pruneSnapshots` use (`dateOf`, `SNAPSHOT_RE` plus a real stamp, `SNAPSHOT_TMP_RE`) rather than a
 * second, independently-anchored pattern, so the two cannot quietly drift apart -- an earlier
 * version's own regex agreed to sweep `brain-9999-99-99.db-wal` although `dateOf` would never treat
 * `brain-9999-99-99.db` itself as a real backup. */
function ownedSidecarBase(base: string): boolean {
  if (dateOf(base) !== null) return true; // brain-<real calendar date>.db
  if (SNAPSHOT_TMP_RE.test(base)) return true; // pre-<tag>-<stamp>.db.tmp, mid-vacuum
  const m = SNAPSHOT_RE.exec(base);
  return m !== null && !Number.isNaN(parseSnapshotStamp(m[2]).getTime()); // pre-<tag>-<real stamp>.db
}

/**
 * Removes every file in `dir` whose name is a `-wal`, `-shm`, or `-journal` suffix on a base name
 * `ownedSidecarBase` recognizes as a `brain-*.db` or `pre-*.db(.tmp)` this job owns, and nothing
 * else, however its name ends. It is one of only two things in this whole design permitted to
 * delete a file it did not write itself, so it refuses outright when `dir` is the data directory
 * rather than the backups directory -- the one place a live database's own `-wal` could otherwise
 * be reached. Builds the complete list of what to delete, and confirms each one is a plain file
 * (never a directory, which `rmSync({force:true})` would otherwise throw `EISDIR` on), before
 * deleting anything. Returns the count removed.
 */
export function sweepSidecars(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  if (path.resolve(dir) === path.resolve(dataDir())) {
    console.error(`[backup] refusing to sweep sidecars in the data directory itself: ${dir}`);
    return 0;
  }
  const toDelete = fs
    .readdirSync(dir)
    .filter((name) => {
      const m = SIDECAR_SUFFIX_RE.exec(name);
      return m !== null && ownedSidecarBase(m[1]);
    })
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
