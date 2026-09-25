/**
 * Runs design §9's audio-release pass right now, rather than waiting for the nightly backup job
 * to get to it -- for "my disk is filling up". Applies `meetings.audioRetentionDays` exactly as
 * the nightly pass would: THE RULE THAT CANNOT BE BROKEN still holds here, unchanged -- a
 * recording with no transcript, or only an empty one, is never released, however old. Then
 * sweeps any `.wav` under `files/meetings` that no meeting item points to any more. This is
 * `scripts/brain.sh release-audio`.
 *
 * Unlike `audio-status.ts` this writes (deletes files, updates item meta, records a fresh
 * footprint snapshot), so it needs the ordinary `getDb()` connection the running app and the
 * nightly job both use, not a bespoke readonly one -- and it does not stop the server first the
 * way `scripts/brain.sh restore` does, because this is a much lighter, narrowly-scoped write
 * that SQLite's own WAL locking already makes safe against the app serving traffic at the same
 * time. What it must not do is become a *second* connection that migrates a database the launchd
 * agent is actively serving -- `getDb()` applies any pending migration on open, same as the
 * app's own boot does, and racing that against a live server is a real hazard `take-backup.ts`'s
 * readonly connection sidesteps by never having schema-affecting work to do at all. This script
 * does have real work to do, so instead of avoiding `getDb()` it checks first and refuses
 * outright when a migration is pending, rather than being the thing that applies it.
 */
import path from "node:path";
import { getDb } from "@/db/client";
import { pendingMigrations } from "@/db/safety";
import { dbPath } from "@/lib/paths";
import { releasableRecordings, releaseAudio, recordAudioFootprint, sweepOrphanAudio } from "@/domain/meetings/audio-retention";
import { formatBytes } from "@/lib/format";

function main(): void {
  const file = dbPath();
  const folder = path.join(process.cwd(), "drizzle");
  const pending = pendingMigrations(file, folder);
  if (pending.length > 0) {
    console.error(
      `refusing to run: ${pending.length} migration(s) are pending (${pending.join(", ")}). Restart the app (or run it once) so its own boot applies them first, then try again.`,
    );
    process.exitCode = 1;
    return;
  }

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
  console.log(released ? `released ${released} recording(s), freeing ${formatBytes(freedBytes)}` : "nothing was due for release");

  const orphans = sweepOrphanAudio(db);
  if (orphans.files) console.log(`swept ${orphans.files} orphaned recording(s), freeing ${formatBytes(orphans.bytes)}`);

  // Keeps the status line's snapshot in step with what this run just did, rather than leaving it
  // to lag until the next nightly pass (design §9.4, and see `recordAudioFootprint`'s own comment).
  recordAudioFootprint(db);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
