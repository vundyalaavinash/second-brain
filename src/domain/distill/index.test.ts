import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, mergeItemMeta } from "@/domain/items";
import { listJobs } from "@/jobs/queue";
import { candidateItemsForDistillation, distillSweepTick } from "./index";

const LONG_BODY = "word ".repeat(50); // > MIN_WORDS

describe("candidateItemsForDistillation", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("includes a quiet, undistilled note with enough content", () => {
    const item = createItem(t.db, { type: "note", title: "Long note", body: LONG_BODY });
    const now = new Date(Date.parse(item.updatedAt) + 31 * 60_000);
    expect(candidateItemsForDistillation(t.db, now)).toContain(item.id);
  });

  it("excludes an item that was just touched", () => {
    const item = createItem(t.db, { type: "note", title: "Fresh note", body: LONG_BODY });
    const now = new Date(Date.parse(item.updatedAt) + 5 * 60_000);
    expect(candidateItemsForDistillation(t.db, now)).not.toContain(item.id);
  });

  it("excludes an item that's too short", () => {
    const item = createItem(t.db, { type: "note", title: "Short", body: "Buy milk" });
    const now = new Date(Date.parse(item.updatedAt) + 31 * 60_000);
    expect(candidateItemsForDistillation(t.db, now)).not.toContain(item.id);
  });

  it("excludes an item that already has a distillation, pending or not", () => {
    const item = createItem(t.db, { type: "note", title: "Already done", body: LONG_BODY });
    mergeItemMeta(t.db, item.id, { distillation: { gist: "", quotes: [], generatedAt: "2026-01-01", status: "pending" } });
    const now = new Date(Date.parse(item.updatedAt) + 31 * 60_000);
    expect(candidateItemsForDistillation(t.db, now)).not.toContain(item.id);
  });

  it("excludes a meeting, journal entry, and review even if quiet and long", () => {
    for (const type of ["meeting", "journal", "review"] as const) {
      const item = createItem(t.db, { type, title: `A ${type}`, body: LONG_BODY });
      const now = new Date(Date.parse(item.updatedAt) + 31 * 60_000);
      expect(candidateItemsForDistillation(t.db, now)).not.toContain(item.id);
    }
  });

  it("excludes an archived item", () => {
    const item = createItem(t.db, { type: "note", title: "Archived", body: LONG_BODY });
    t.db.run(`update items set archived_at = '2026-01-01T00:00:00.000Z' where id = ${item.id}`);
    const now = new Date(Date.parse(item.updatedAt) + 31 * 60_000);
    expect(candidateItemsForDistillation(t.db, now)).not.toContain(item.id);
  });

  it("costs exactly one query for any number of candidates", () => {
    for (let i = 0; i < 10; i++) createItem(t.db, { type: "note", title: `Note ${i}`, body: LONG_BODY });
    const spy = vi.spyOn(t.db, "select");
    const now = new Date(Date.now() + 31 * 60_000);
    candidateItemsForDistillation(t.db, now);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("distillSweepTick", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("enqueues exactly one distill_note job per candidate and none for an ineligible item", () => {
    const eligible = createItem(t.db, { type: "note", title: "Eligible", body: LONG_BODY });
    const tooShort = createItem(t.db, { type: "note", title: "Too short", body: "Buy milk" });
    const now = new Date(Date.parse(eligible.updatedAt) + 31 * 60_000);

    distillSweepTick(t.db, now);

    const jobs = listJobs(t.db).filter((j) => j.type === "distill_note");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].itemId).toBe(eligible.id);
    expect(jobs.some((j) => j.itemId === tooShort.id)).toBe(false);
  });
});
