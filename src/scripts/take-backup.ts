/**
 * Takes one backup right now, through the exact same code the nightly job runs --
 * `createBackupHandler` -- rather than a second implementation of "take a backup" that could rot
 * out of step with the first. This is `scripts/brain.sh backup`.
 *
 * It enqueues a real "backup" job and runs it once through a `JobWorker`, the same
 * claim-then-complete-or-fail path production uses (`JobWorker.runOnce`, called in a loop by
 * `boot()`), rather than calling the handler bare -- so a backup taken from the command line
 * leaves the same trail in the jobs table a nightly one does. The handler itself never throws on
 * a failed verification (it deletes the bad file and records the failure instead, so the
 * attachments backup and activity prune underneath it still run), so what actually answers "did
 * it work" is `getLastDbCheck()` -- the same status both boot and the nightly job write through --
 * not the job's own queued/done/failed status.
 */
import { getDb } from "@/db/client";
import { JobWorker } from "@/jobs/worker";
import { enqueueJob } from "@/jobs/queue";
import { createBackupHandler, backupFilePath } from "@/jobs/handlers/backup";
import { getLastDbCheck } from "@/db/safety";

async function main(): Promise<void> {
  const db = getDb();
  try {
    enqueueJob(db, "backup", {});
    const worker = new JobWorker(db, { backup: createBackupHandler({ db }) }, { log: (m) => console.log(`[backup] ${m}`) });
    const ran = await worker.runOnce();
    if (!ran) {
      console.error("no backup job was claimed");
      process.exitCode = 1;
      return;
    }

    const check = getLastDbCheck();
    if (check?.ok) {
      console.log(`backup written and verified: ${backupFilePath()}`);
    } else {
      console.error(`backup failed verification and was discarded: ${(check?.problems ?? ["no check was recorded"]).join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    db.$client.close();
  }
}

void main();
