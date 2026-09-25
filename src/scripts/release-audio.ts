/**
 * Runs design §9's audio-release pass right now, rather than waiting for the nightly backup job
 * to get to it -- for "my disk is filling up". Applies `meetings.audioRetentionDays` exactly as
 * the nightly pass would: THE RULE THAT CANNOT BE BROKEN still holds here, unchanged -- a
 * recording with no transcript, or only an empty one, is never released, however old. Then
 * sweeps any `.wav` under `files/meetings` that no meeting item points to any more. This is
 * `scripts/brain.sh release-audio`.
 *
 * Unlike `audio-status.ts` this writes (deletes files, updates item meta), so it goes through
 * the same `getDb()` the running app and the nightly job both use -- the ordinary, already-
 * migrated connection, not a bespoke readonly one. A mutating admin action going through the
 * app's own database path is the established shape for this (see `scripts/brain.sh restore`);
 * what `take-backup.ts` avoids is a *diagnostic* tool quietly becoming the thing that migrates,
 * which does not describe a command whose entire purpose is to change what is on disk.
 */
import { getDb } from "@/db/client";
import { releasableRecordings, releaseAudio, sweepOrphanAudio } from "@/domain/meetings/audio-retention";

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function main(): void {
  const db = getDb();

  let released = 0;
  let freedBytes = 0;
  for (const recording of releasableRecordings(db)) {
    const result = releaseAudio(db, recording.itemId);
    if (result) {
      released += 1;
      freedBytes += result.freedBytes;
    }
  }
  console.log(released ? `released ${released} recording(s), freeing ${mb(freedBytes)} MB` : "nothing was due for release");

  const orphans = sweepOrphanAudio(db);
  if (orphans.files) console.log(`swept ${orphans.files} orphaned recording(s), freeing ${mb(orphans.bytes)} MB`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
