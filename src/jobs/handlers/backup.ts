import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { dataDir } from "@/lib/paths";
import { pruneActivity, retentionDays } from "@/domain/activity";

const KEEP = 7;
const NAME_RE = /^brain-.*\.db$/;

/** Local YYYY-MM-DD stamp used in backup file names. */
export function backupDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

export function backupFilePath(now: Date = new Date()): string {
  return path.join(backupsDir(), `brain-${backupDateStamp(now)}.db`);
}

/** Keep only the newest `keep` backup files (by name, which sorts chronologically). */
function pruneOldBackups(dir: string, keep: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((name) => NAME_RE.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest (lexically largest) first
  for (const name of files.slice(keep)) {
    fs.rmSync(path.join(dir, name));
  }
}

/** Nightly online backup of the open database, pruned to the newest 7 files. */
export function createBackupHandler(deps: { db: DB }): JobHandler {
  return async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = backupFilePath();
    await deps.db.$client.backup(file);
    pruneOldBackups(dir, KEEP);
    const pruned = pruneActivity(deps.db, retentionDays(deps.db));
    if (pruned.sessions || pruned.events) console.log(`[backup] pruned ${pruned.sessions} activity session(s), ${pruned.events} event(s)`);
  };
}
