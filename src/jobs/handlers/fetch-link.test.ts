import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, getItemChunks, parseMeta } from "@/domain/items";
import { enqueueJob, listJobs } from "@/jobs/queue";
import { ARTICLE_HTML } from "@/test/fixtures";
import { createFetchLinkHandler } from "./fetch-link";

describe("fetch_link handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("fills title, extracted text, meta, chunks, and queues embedding", async () => {
    const url = "https://example.test/post";
    const item = createItem(t.db, { type: "link", title: url, sourceUrl: url });
    const job = enqueueJob(t.db, "fetch_link", { itemId: item.id }, item.id);
    const fetchImpl: typeof fetch = async () => new Response(ARTICLE_HTML, { status: 200 });
    await createFetchLinkHandler({ db: t.db, fetchImpl })(job);

    const after = getItem(t.db, item.id)!;
    expect(after.title).toMatch(/Test Article/);
    expect(after.extractedText).toMatch(/second brain keeps/);
    expect(after.status).toBe("processing");
    expect(parseMeta<{ fetched_at: string }>(after).fetched_at).toBeTruthy();
    expect(getItemChunks(t.db, item.id).length).toBeGreaterThan(0);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["fetch_link", "embed"]);
  });

  it("keeps a user-provided title", async () => {
    const item = createItem(t.db, { type: "link", title: "My title", sourceUrl: "https://example.test/post" });
    const job = enqueueJob(t.db, "fetch_link", { itemId: item.id }, item.id);
    const fetchImpl: typeof fetch = async () => new Response(ARTICLE_HTML, { status: 200 });
    await createFetchLinkHandler({ db: t.db, fetchImpl })(job);
    expect(getItem(t.db, item.id)?.title).toBe("My title");
  });

  it("throws when the item has no url", async () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const job = enqueueJob(t.db, "fetch_link", { itemId: item.id }, item.id);
    await expect(createFetchLinkHandler({ db: t.db })(job)).rejects.toThrow(/no source url/i);
  });
});
