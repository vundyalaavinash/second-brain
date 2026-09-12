import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { jobs, type Job, type JobType, type JobStatus } from "@/db/schema";
import { updateItem } from "@/domain/items";

export const BACKOFF_MS = [10_000, 60_000, 300_000] as const;
export const MAX_ATTEMPTS = 3;

export function enqueueJob(db: DB, type: JobType, payload: Record<string, unknown> = {}, itemId?: number): Job {
  const now = new Date().toISOString();
  const row = db
    .insert(jobs)
    .values({
      type,
      payload: JSON.stringify(payload),
      status: "queued",
      attempts: 0,
      runAfter: now,
      itemId: itemId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function claimNextJob(db: DB, now: Date = new Date(), allowedTypes?: JobType[]): Job | undefined {
  const iso = now.toISOString();
  return db.transaction((tx) => {
    const conds = [eq(jobs.status, "queued"), lte(jobs.runAfter, iso)];
    if (allowedTypes) {
      if (allowedTypes.length === 0) return undefined;
      conds.push(inArray(jobs.type, allowedTypes));
    }
    const next = tx
      .select()
      .from(jobs)
      .where(and(...conds))
      .orderBy(asc(jobs.runAfter), asc(jobs.id))
      .limit(1)
      .get();
    if (!next) return undefined;
    return tx.update(jobs).set({ status: "running", updatedAt: iso }).where(eq(jobs.id, next.id)).returning().get();
  });
}

function getJob(db: DB, id: number): Job {
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) throw new Error(`Job ${id} not found`);
  return job;
}

export function completeJob(db: DB, id: number, now: Date = new Date()): void {
  db.update(jobs).set({ status: "done", error: null, updatedAt: now.toISOString() }).where(eq(jobs.id, id)).run();
}

export function failJob(db: DB, id: number, error: string, now: Date = new Date()): Job {
  const job = getJob(db, id);
  const attempts = job.attempts + 1;
  const permanent = attempts >= MAX_ATTEMPTS;
  const runAfter = permanent ? job.runAfter : new Date(now.getTime() + BACKOFF_MS[attempts - 1]).toISOString();
  const updated = db
    .update(jobs)
    .set({
      status: permanent ? "failed" : "queued",
      attempts,
      error,
      runAfter,
      updatedAt: now.toISOString(),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`Job ${id} not found`);
  if (job.itemId) {
    updateItem(db, job.itemId, permanent ? { status: "failed", error } : { error });
  }
  return updated;
}

export function retryJob(db: DB, id: number, now: Date = new Date()): Job {
  const job = getJob(db, id);
  const updated = db
    .update(jobs)
    .set({ status: "queued", attempts: 0, error: null, runAfter: now.toISOString(), updatedAt: now.toISOString() })
    .where(eq(jobs.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`Job ${id} not found`);
  if (job.itemId) updateItem(db, job.itemId, { status: "pending", error: null });
  return updated;
}

export function retryFailedJobsForItem(db: DB, itemId: number, now: Date = new Date()): number {
  const failed = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.itemId, itemId), eq(jobs.status, "failed")))
    .all();
  for (const job of failed) retryJob(db, job.id, now);
  return failed.length;
}

/** Called once at boot: anything still "running" belonged to a process that died. */
export function resetRunningJobs(db: DB, now: Date = new Date()): number {
  const result = db
    .update(jobs)
    .set({ status: "queued", updatedAt: now.toISOString() })
    .where(eq(jobs.status, "running"))
    .run();
  return Number(result.changes);
}

export function listJobs(db: DB, filter: { itemId?: number; status?: JobStatus } = {}): Job[] {
  const conds = [];
  if (filter.itemId !== undefined) conds.push(eq(jobs.itemId, filter.itemId));
  if (filter.status) conds.push(eq(jobs.status, filter.status));
  return db
    .select()
    .from(jobs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(jobs.id))
    .all();
}
