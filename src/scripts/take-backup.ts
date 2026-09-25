/**
 * Takes one backup right now, read-only, and does nothing else. This is `scripts/brain.sh backup`.
 *
 * This used to reuse `createBackupHandler` wholesale, through `JobWorker`. That went through
 * `getDb()` / `openDatabase()`, which applies any pending migration before it does anything else
 * -- fine for the nightly job, which the app already trusts to touch the database on its own
 * schedule, but wrong for a command the runbook sells as the safe thing to run "before I do this
 * thing": it must not be the thing that does the risky thing. Reproduced: running this bare (no
 * `SB_DATA_DIR`, exactly what a developer reaching for the script would type) opened the
 * *production* database read-write and would have migrated it if anything were pending. It also
 * pruned activity rows on every run, through the same reused handler -- a "backup" that deletes
 * data.
 *
 * So this now opens the database file directly and strictly `readonly`, skipping `openDatabase`
 * entirely -- no migration, no pre-migration snapshot, no write of any kind to the live file --
 * takes the backup through the same SQLite backup API the nightly job uses (confirmed: a readonly
 * connection's `.backup()` still captures rows that are only in the WAL, exactly like the nightly
 * job's own read-write connection does), and verifies what it wrote with the same
 * `verifyDatabaseFile` everything else in this design uses. Then it stops: no retention prune, no
 * sidecar sweep, no attachments copy, no activity prune. Housekeeping stays the nightly job's job.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { dbPath } from "@/lib/paths";
import { backupsDir, backupFilePath } from "@/jobs/handlers/backup";
import { verifyDatabaseFile, recordDbCheck, writeBackupCheckSetting } from "@/db/safety";

async function main(): Promise<void> {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    throw new Error(`no database at ${file}`);
  }

  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    fs.mkdirSync(backupsDir(), { recursive: true });
    const dest = backupFilePath();
    await sqlite.backup(dest);

    const check = verifyDatabaseFile(dest);
    recordDbCheck(check, "backup");
    // This process exits right after main() returns, which would otherwise take the record above
    // with it -- persisted here so a failed `npm run backup` stays visible to the running app,
    // not just to whoever's terminal this was. A short-lived writable connection of its own (see
    // `writeBackupCheckSetting`'s doc comment): it never calls `migrate()`, so it carries none of
    // the risk this file's own readonly connection above exists to avoid.
    writeBackupCheckSetting(file, check);
    if (check.ok) {
      console.log(`backup written and verified: ${dest}`);
    } else {
      fs.rmSync(dest, { force: true });
      console.error(`backup failed verification and was discarded: ${check.problems.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(`backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
