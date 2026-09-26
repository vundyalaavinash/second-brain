import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta } from "@/domain/items";
import { enqueueJob } from "@/jobs/queue";
import type { Job } from "@/db/schema";
import { createDistillNoteHandler } from "./distill-note";
import type { Distillation } from "@/domain/distill";
import type { GistProvider } from "@/providers/gist";

const LONG_BODY =
  "The migration touched every downstream consumer of the events table. " +
  "We agreed to freeze schema changes until the audit finishes. " +
  "Lunch was fine and unremarkable today, nothing worth noting there. " +
  "The audit itself is scheduled for next Tuesday with the platform team. " +
  "Nobody signed up to own the rollback plan yet, which is the real risk here.";

function fakeGist(text: string): GistProvider {
  return { gist: vi.fn().mockResolvedValue(text) };
}

describe("createDistillNoteHandler", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  function job(itemId: number): Job {
    return enqueueJob(t.db, "distill_note", { itemId }, itemId);
  }

  it("saves a pending distillation onto the item's meta when the model is present", async () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: LONG_BODY });
    const handler = createDistillNoteHandler({ db: t.db, gist: fakeGist("A short paragraph.") });
    await handler(job(item.id));
    const updated = getItem(t.db, item.id)!;
    const meta = parseMeta<{ distillation?: Distillation }>(updated);
    expect(meta.distillation?.status).toBe("pending");
    expect(meta.distillation?.gist).toBe("A short paragraph.");
    expect(meta.distillation?.quotes.length).toBeGreaterThanOrEqual(2);
  });

  it("does nothing when no gist model is present, same as summarize_meeting with no key", async () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: LONG_BODY });
    const handler = createDistillNoteHandler({ db: t.db, gist: null });
    await handler(job(item.id));
    const updated = getItem(t.db, item.id)!;
    expect(parseMeta<{ distillation?: Distillation }>(updated).distillation).toBeUndefined();
  });

  it("records an inert, already-dismissed distillation when fewer than MIN_QUOTES verify", async () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: "Buy milk and eggs tomorrow morning early." });
    const handler = createDistillNoteHandler({ db: t.db, gist: fakeGist("unused") });
    await handler(job(item.id));
    const updated = getItem(t.db, item.id)!;
    const meta = parseMeta<{ distillation?: Distillation }>(updated);
    expect(meta.distillation).toEqual({ gist: "", quotes: [], generatedAt: expect.any(String), status: "dismissed" });
  });

  it("records an inert, already-dismissed distillation and does not throw when the gist call fails", async () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: LONG_BODY });
    const handler = createDistillNoteHandler({ db: t.db, gist: { gist: vi.fn().mockRejectedValue(new Error("boom")) } });
    await expect(handler(job(item.id))).resolves.toBeUndefined();
    const updated = getItem(t.db, item.id)!;
    const meta = parseMeta<{ distillation?: Distillation }>(updated);
    expect(meta.distillation).toEqual({ gist: "", quotes: [], generatedAt: expect.any(String), status: "dismissed" });
  });
});
