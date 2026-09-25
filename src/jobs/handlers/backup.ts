import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { attachmentsDir, backupsDir } from "@/lib/paths";
import { pruneActivity, retentionDays } from "@/domain/activity";

export { backupsDir };

const KEEP = 7;
const NAME_RE = /^brain-.*\.db$/;
const ATTACHMENTS_NAME_RE = /^attachments-.*$/;

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

/** Nightly online backup of the open database and the attachments directory, each pruned to the newest 7. */
export function createBackupHandler(deps: { db: DB }): JobHandler {
  return async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = backupFilePath();
    await deps.db.$client.backup(file);
    pruneOld(dir, KEEP, NAME_RE);
    const attSrc = attachmentsDir();
    if (fs.existsSync(attSrc)) {
      const dest = attachmentsBackupPath();
      // Remove any existing same-day backup first so files deleted since are not left behind by cpSync's merge.
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(attSrc, dest, { recursive: true });
    }
    pruneOld(dir, KEEP, ATTACHMENTS_NAME_RE);
    const pruned = pruneActivity(deps.db, retentionDays(deps.db));
    if (pruned.sessions || pruned.events) console.log(`[backup] pruned ${pruned.sessions} activity session(s), ${pruned.events} event(s)`);
  };
}
