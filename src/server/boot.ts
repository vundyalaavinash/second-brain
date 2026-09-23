import fs from "node:fs";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { JobWorker } from "@/jobs/worker";
import { createJobHandlers } from "@/jobs/handlers";
import { resetRunningJobs, enqueueJob } from "@/jobs/queue";
import { backupFilePath } from "@/jobs/handlers/backup";
import { migrateNextSteps } from "@/domain/tasks/migrate-next-steps";
import { autoStartTick } from "@/domain/meetings/auto-start";
import { reconcileRecordings, stopForShutdown } from "@/domain/meetings/reconcile";
import { hasChatKey } from "@/providers/chat";
import { syncCalendarFeed } from "@/domain/activity";
import { getEmbedProvider } from "./providers";

const g = globalThis as unknown as {
  __sbWorker?: JobWorker;
  __sbBackupInterval?: NodeJS.Timeout;
  __sbAutoStartInterval?: NodeJS.Timeout; __sbFeedInterval?: NodeJS.Timeout;
  __sbShutdownHooked?: boolean;
};

/** Outlook republishes a calendar every few minutes; polling faster only re-reads the same file. */
const FEED_CHECK_MS = 5 * 60_000;
const FEED_FIRST_MS = 15_000;

/** Every 6 hours we check whether today's backup exists yet; cheap enough to just poll. */
const BACKUP_CHECK_MS = 6 * 60 * 60 * 1000;

/** Half a minute: fine enough to catch a meeting's start inside the two-minute window. */
const AUTO_START_CHECK_MS = 30 * 1000;

function ensureTodayBackupQueued(db: DB): void {
  if (!fs.existsSync(backupFilePath())) enqueueJob(db, "backup", {});
}

/**
 * Ask the recorder to stop before the process goes, so `sb-recorder` flushes its WAV header
 * and next boot's sweep finds a playable file. Once per process: HMR re-runs `boot`, and a
 * stack of handlers would each try to stop the same helper.
 *
 * Under `next start` Next registers its own signal cleanup first and exits on its own once
 * the HTTP server has closed, so the 3 s budget is best effort, not a guarantee: launchd
 * signals the whole process group and `sb-recorder` handles SIGTERM itself, which is what
 * actually keeps the WAV whole when this handler is cut short.
 */
function hookShutdown(): void {
  if (g.__sbShutdownHooked) return;
  g.__sbShutdownHooked = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void stopForShutdown({ log: (m) => console.log(`[shutdown] ${m}`) }).finally(() => {
        // This handler is gone with `once`; the re-raise reaches Next's own cleanup (already
        // running, so a no-op) or, without it, Node's default exit.
        process.kill(process.pid, signal);
      });
    });
  }
}

export function boot(): JobWorker {
  if (g.__sbWorker) return g.__sbWorker;
  const db = getDb();
  const reset = resetRunningJobs(db);
  if (reset > 0) console.log(`[boot] requeued ${reset} interrupted job(s)`);
  try {
    const swept = reconcileRecordings(db, (m) => console.log(`[boot] ${m}`));
    if (swept.done + swept.failed > 0) console.log(`[boot] closed ${swept.done + swept.failed} interrupted recording(s)`);
  } catch (err) {
    console.error(`[boot] could not reconcile recordings:`, err);
  }
  hookShutdown();
  try {
    const m = migrateNextSteps(db);
    if (m.containers) console.log(`[boot] migrated ${m.containers} next-steps checklist(s) into ${m.tasks} task(s)`);
  } catch (err) {
    console.error(`[boot] next-steps migration failed:`, err);
  }
  const embed = getEmbedProvider();
  if (!embed) console.warn("[boot] SB_EMBED=off: semantic search disabled");
  // Read once for the log line; the handlers ask again per job, so a key added later works.
  if (!hasChatKey(db)) console.log("[boot] no Anthropic key: meeting summaries are off");
  const worker = new JobWorker(db, createJobHandlers({ db, embed, hasChatKey: () => hasChatKey(db) }), {
    log: (m) => console.log(`[worker] ${m}`),
  });
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
  if (!g.__sbFeedInterval) {
    // A published calendar link, when one is set; the sync records its own errors.
    const feed = () => void syncCalendarFeed(db, { log: (m) => console.log(`[calendar-feed] ${m}`) });
    setTimeout(feed, FEED_FIRST_MS).unref();
    g.__sbFeedInterval = setInterval(feed, FEED_CHECK_MS);
  }
  if (!g.__sbAutoStartInterval) {
    // The tick swallows its own errors; the setting it reads decides whether it does anything.
    g.__sbAutoStartInterval = setInterval(() => void autoStartTick(db, { log: (m) => console.log(`[auto-record] ${m}`) }), AUTO_START_CHECK_MS);
  }
  console.log("[boot] job worker started");
  return worker;
}

export function getWorker(): JobWorker | undefined {
  return g.__sbWorker;
}
