import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import { getLastDbCheck, type CheckResult } from "@/db/safety";
import { recoveryPointSummary } from "@/jobs/handlers/backup";
import { audioFootprint, type AudioFootprint } from "@/domain/meetings/audio-retention";
import { backupsDir } from "@/lib/paths";

export interface SafetyStatus {
  /** When the newest surviving `brain-*.db` was actually written (its mtime, not its date-only
   * file name), or `null` when none has ever survived. */
  lastBackupAt: string | null;
  /** Whether the most recent thing `getLastDbCheck` recorded *about a backup* passed. `true`
   * unless that record's own source is `"backup"` and it failed -- a boot check, or no record at
   * all, is not evidence the backup itself is bad, so it does not claim it is (design §7: the app
   * says what it knows, not more). A same-night failure this catches even when the file it
   * discarded is too recent for `lastBackupAt`'s two-day check to have noticed yet. */
  verified: boolean;
  /** How many `brain-*.db` backups currently survive `pruneBackups`' tiers. */
  recoveryPoints: number;
  /** The oldest surviving backup's date (`YYYY-MM-DD`), or `null` when there are none. */
  oldest: string | null;
  /** The most recently recorded integrity/search check, from whichever of boot or the backup job
   * ran last -- `db/safety.ts`'s single shared verdict. `{ ok: false, ... }` when nothing has been
   * recorded yet: silence must mean checked and sound, never merely unchecked (design §2, §7). */
  integrity: CheckResult;
  /** Design §9: how many recordings are held, how much space, and when the next release is due. */
  audio: AudioFootprint;
}

/**
 * Reads what the nightly backup job and boot's own check already recorded for design §7's status
 * surface -- it does not run a check of its own. Cheap by construction, safe to call on every
 * page load: one `readdirSync` of the backups directory, one `statSync` of the newest surviving
 * backup for its mtime, and a read of `getLastDbCheck`'s single in-memory slot. Nothing here
 * opens or copies a database file -- that is what `npm run verify` is for, not a status read.
 *
 * `now` follows the same rule every clock-needing function in this design does -- a default so
 * tests never depend on the real one -- though nothing here reads it yet: `audioFootprint`
 * reports an absolute due instant rather than something already relative to `now`, so it is the
 * caller (`describeSafety`) that turns it into "in 3 days" against its own clock.
 */
export function safetyStatus(db: DB, now: Date = new Date()): SafetyStatus {
  void now;

  const dir = backupsDir();
  const { count, oldest, newest } = recoveryPointSummary(dir);
  const lastBackupAt = newest ? fs.statSync(path.join(dir, newest)).mtime.toISOString() : null;

  const last = getLastDbCheck();
  const integrity: CheckResult = last ? { ok: last.ok, problems: last.problems } : { ok: false, problems: ["no integrity check has run yet"] };
  const verified = !(last?.source === "backup" && !last.ok);

  return { lastBackupAt, verified, recoveryPoints: count, oldest, integrity, audio: audioFootprint(db) };
}
