import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { enqueueJob, listJobs } from "./queue";
import { JobWorker } from "./worker";

describe("JobWorker", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("runs a handler for the next job and reports whether it ran", async () => {
    const seen: number[] = [];
    const worker = new JobWorker(t.db, {
      embed: async (job) => {
        seen.push(job.id);
      },
    });
    const job = enqueueJob(t.db, "embed", {});
    expect(await worker.runOnce()).toBe(true);
    expect(seen).toEqual([job.id]);
    expect(listJobs(t.db, { status: "done" })).toHaveLength(1);
    expect(await worker.runOnce()).toBe(false);
  });

  it("records a failure when the handler throws or is missing", async () => {
    const worker = new JobWorker(t.db, {
      embed: async () => {
        throw new Error("nope");
      },
    });
    enqueueJob(t.db, "embed", {});
    enqueueJob(t.db, "fetch_link", {});
    await worker.runOnce(new Date(Date.now() + 1000));
    await worker.runOnce(new Date(Date.now() + 1000));
    const all = listJobs(t.db);
    expect(all[0].error).toBe("nope");
    expect(all[0].status).toBe("queued");
    expect(all[1].error).toMatch(/No handler for job type fetch_link/);
  });

  it("only claims allowed types when restricted", async () => {
    const worker = new JobWorker(t.db, { embed: async () => {}, fetch_link: async () => {} });
    enqueueJob(t.db, "embed", {});
    enqueueJob(t.db, "fetch_link", {});
    worker.restrictTo(["fetch_link"]);
    expect(await worker.runOnce()).toBe(true);
    expect(listJobs(t.db, { status: "done" })[0].type).toBe("fetch_link");
    expect(await worker.runOnce()).toBe(false);
    worker.restrictTo(undefined);
    expect(await worker.runOnce()).toBe(true);
  });

  it("polls in the background until stopped", async () => {
    let ran = 0;
    const worker = new JobWorker(t.db, { embed: async () => { ran++; } }, { pollMs: 20 });
    worker.start();
    enqueueJob(t.db, "embed", {});
    await new Promise((r) => setTimeout(r, 120));
    worker.stop();
    expect(ran).toBe(1);
  });
});
