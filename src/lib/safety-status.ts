import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import { getLastDbCheck, getLastBackupCheck, type CheckResult } from "@/db/safety";
import { recoveryPointSummary } from "@/jobs/handlers/backup";
import { readAudioFootprintSnapshot, type AudioFootprint } from "@/domain/meetings/audio-retention";
import { backupsDir } from "@/lib/paths";

export interface SafetyStatus {
  /** When the newest surviving `brain-*.db` was actually written (its mtime, not its date-only
   * file name), or `null` when none has ever survived. */
  lastBackupAt: string | null;
  /** Whether the last thing the backup job (or `npm run backup`) actually verified passed --
   * read from the persisted record `getLastBackupCheck` keeps (see its doc comment in
   * `db/safety.ts` for why this cannot be the in-memory slot alone: a process restart between a
   * failed backup and the next status read must not let an unrelated boot check paper over it).
   * No record at all is not evidence the backup itself is bad, so it does not claim it is (design
   * §7: the app says what it knows, not more) -- `true` in that case. A same-night failure this
   * catches even when the file it discarded is too recent for `lastBackupAt`'s two-day check to
   * have noticed yet. */
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
 * backup for its mtime, a read of `getLastDbCheck`'s in-memory slot, one settings-row read for
 * the persisted backup check, and one for the audio footprint snapshot `recordAudioFootprint`
 * keeps current (`readAudioFootprintSnapshot` -- an O(1) read, never the O(number of meetings)
 * scan `audioFootprint` itself is; measured at 17.59 ms at three thousand meetings before this
 * read moved off the request path). Nothing here opens or copies a database file, and nothing
 * here scans every meeting item -- that is what `npm run verify` and `npm run audio-status` are
 * for, not a status read.
 *
 * `now` follows the same rule every clock-needing function in this design does -- a default so
 * tests never depend on the real one -- though nothing here reads it yet: everything this reads
 * is either an absolute instant or already-computed, so it is the caller (`describeSafety`) that
 * turns any of it into "in 3 days" against its own clock.
 */
export function safetyStatus(db: DB, now: Date = new Date()): SafetyStatus {
  void now;

  const dir = backupsDir();
  const { count, oldest, newest } = recoveryPointSummary(dir);
  const lastBackupAt = newest ? fs.statSync(path.join(dir, newest)).mtime.toISOString() : null;

  const last = getLastDbCheck();
  const integrity: CheckResult = last ? { ok: last.ok, problems: last.problems } : { ok: false, problems: ["no integrity check has run yet"] };
  const persistedBackupCheck = getLastBackupCheck(db.$client);
  // Prefers the persisted, backup-specific record once one exists: it survives a restart and is
  // never overwritten by an unrelated boot check, unlike the in-memory fallback below (kept only
  // for a database that predates this record -- never backed up yet in this design's lifetime).
  const verified = persistedBackupCheck ? persistedBackupCheck.ok : !(last?.source === "backup" && !last.ok);

  return { lastBackupAt, verified, recoveryPoints: count, oldest, integrity, audio: readAudioFootprintSnapshot(db) };
}
