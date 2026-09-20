import fs from "node:fs";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { JobWorker } from "@/jobs/worker";
import { createJobHandlers } from "@/jobs/handlers";
import { resetRunningJobs, enqueueJob } from "@/jobs/queue";
import { backupFilePath } from "@/jobs/handlers/backup";
import { migrateNextSteps } from "@/domain/tasks/migrate-next-steps";
import { getEmbedProvider } from "./providers";

const g = globalThis as unknown as { __sbWorker?: JobWorker; __sbBackupInterval?: NodeJS.Timeout };

/** Every 6 hours we check whether today's backup exists yet; cheap enough to just poll. */
const BACKUP_CHECK_MS = 6 * 60 * 60 * 1000;

function ensureTodayBackupQueued(db: DB): void {
  if (!fs.existsSync(backupFilePath())) enqueueJob(db, "backup", {});
}

export function boot(): JobWorker {
  if (g.__sbWorker) return g.__sbWorker;
  const db = getDb();
  const reset = resetRunningJobs(db);
  if (reset > 0) console.log(`[boot] requeued ${reset} interrupted job(s)`);
  try {
    const m = migrateNextSteps(db);
    if (m.containers) console.log(`[boot] migrated ${m.containers} next-steps checklist(s) into ${m.tasks} task(s)`);
  } catch (err) {
    console.error(`[boot] next-steps migration failed:`, err);
  }
  const embed = getEmbedProvider();
  if (!embed) console.warn("[boot] SB_EMBED=off: semantic search disabled");
  const worker = new JobWorker(db, createJobHandlers({ db, embed }), { log: (m) => console.log(`[worker] ${m}`) });
  worker.start();
  if (embed) {
    void embed
      .embed(["warmup"])
      .then(() => console.log("[boot] embedding model ready"))
      .catch((err) => console.warn(`[boot] embedding model unavailable: ${err instanceof Error ? err.message : String(err)}`));
  }
  g.__sbWorker = worker;
  ensureTodayBackupQueued(db);
  if (!g.__sbBackupInterval) {
    g.__sbBackupInterval = setInterval(() => ensureTodayBackupQueued(db), BACKUP_CHECK_MS);
  }
  console.log("[boot] job worker started");
  return worker;
}

export function getWorker(): JobWorker | undefined {
  return g.__sbWorker;
}
