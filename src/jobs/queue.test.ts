import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem } from "@/domain/items";
import {
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
  retryJob,
  retryFailedJobsForItem,
  resetRunningJobs,
  listJobs,
  BACKOFF_MS,
} from "./queue";
import { jobPayload } from "./payload";

// Fixed past date for backoff arithmetic; claims use real time so run_after (set to "now" on enqueue) is reachable.
const T0 = new Date("2026-01-01T00:00:00.000Z");
const plus = (ms: number) => new Date(Date.now() + ms);

describe("job queue", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("enqueues and claims oldest first, marking it running", () => {
    const a = enqueueJob(t.db, "embed", { itemId: 1 });
    const b = enqueueJob(t.db, "fetch_link", { itemId: 2 });
    expect(a.status).toBe("queued");
    expect(jobPayload<{ itemId: number }>(a).itemId).toBe(1);
    const claimed = claimNextJob(t.db, plus(1000));
    expect(claimed?.id).toBe(a.id);
    expect(claimed?.status).toBe("running");
    expect(claimNextJob(t.db, plus(1000))?.id).toBe(b.id);
    expect(claimNextJob(t.db, plus(1000))).toBeUndefined();
  });

  it("respects run_after and allowed types", () => {
    const job = enqueueJob(t.db, "embed", {});
    expect(claimNextJob(t.db, new Date(new Date(job.runAfter).getTime() - 1))).toBeUndefined();
    enqueueJob(t.db, "fetch_link", {});
    const claimed = claimNextJob(t.db, plus(60_000), ["fetch_link"]);
    expect(claimed?.type).toBe("fetch_link");
  });

  it("completes a job", () => {
    const job = enqueueJob(t.db, "embed", {});
    claimNextJob(t.db, plus(1));
    completeJob(t.db, job.id, plus(2));
    expect(listJobs(t.db, { status: "done" }).map((j) => j.id)).toEqual([job.id]);
  });

  it("requeues with backoff, then fails permanently and marks the item", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const job = enqueueJob(t.db, "embed", { itemId: item.id }, item.id);

    claimNextJob(t.db, plus(1));
    const first = failJob(t.db, job.id, "boom 1", T0);
    expect(first.status).toBe("queued");
    expect(first.attempts).toBe(1);
    expect(new Date(first.runAfter).getTime()).toBe(T0.getTime() + BACKOFF_MS[0]);
    expect(getItem(t.db, item.id)?.error).toBe("boom 1");
    expect(getItem(t.db, item.id)?.status).toBe("pending");

    claimNextJob(t.db, plus(1));
    const second = failJob(t.db, job.id, "boom 2", T0);
    expect(second.status).toBe("queued");
    expect(new Date(second.runAfter).getTime()).toBe(T0.getTime() + BACKOFF_MS[1]);

    claimNextJob(t.db, plus(1));
    const third = failJob(t.db, job.id, "boom 3", T0);
    expect(third.status).toBe("failed");
    expect(third.attempts).toBe(3);
    expect(getItem(t.db, item.id)?.status).toBe("failed");
    expect(getItem(t.db, item.id)?.error).toBe("boom 3");
  });

  it("retries a failed job and clears the item error", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const job = enqueueJob(t.db, "embed", { itemId: item.id }, item.id);
    for (let i = 0; i < 3; i++) {
      claimNextJob(t.db, plus(1));
      failJob(t.db, job.id, "x", T0);
    }
    expect(retryFailedJobsForItem(t.db, item.id, plus(1))).toBe(1);
    const again = listJobs(t.db, { itemId: item.id })[0];
    expect(again.status).toBe("queued");
    expect(again.attempts).toBe(0);
    expect(again.error).toBeNull();
    expect(getItem(t.db, item.id)?.status).toBe("pending");
    expect(getItem(t.db, item.id)?.error).toBeNull();
    const single = retryJob(t.db, job.id, plus(2));
    expect(single.status).toBe("queued");
  });

  it("resets jobs left running by a crashed process", () => {
    enqueueJob(t.db, "embed", {});
    claimNextJob(t.db, plus(1));
    expect(resetRunningJobs(t.db, plus(2))).toBe(1);
    expect(listJobs(t.db, { status: "queued" })).toHaveLength(1);
  });
});
