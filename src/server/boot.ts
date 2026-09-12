import { getDb } from "@/db/client";
import { JobWorker } from "@/jobs/worker";
import { createJobHandlers } from "@/jobs/handlers";
import { resetRunningJobs } from "@/jobs/queue";

const g = globalThis as unknown as { __sbWorker?: JobWorker };

export function boot(): JobWorker {
  if (g.__sbWorker) return g.__sbWorker;
  const db = getDb();
  const reset = resetRunningJobs(db);
  if (reset > 0) console.log(`[boot] requeued ${reset} interrupted job(s)`);
  const worker = new JobWorker(db, createJobHandlers({ db }), { log: (m) => console.log(`[worker] ${m}`) });
  worker.start();
  g.__sbWorker = worker;
  console.log("[boot] job worker started");
  return worker;
}

export function getWorker(): JobWorker | undefined {
  return g.__sbWorker;
}
