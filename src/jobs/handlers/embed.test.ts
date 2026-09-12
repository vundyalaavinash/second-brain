import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, rechunkItem, updateItem } from "@/domain/items";
import { enqueueJob } from "@/jobs/queue";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import { countChunkVectors } from "@/domain/search/vectors";
import { createEmbedHandler } from "./embed";

describe("embed handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("embeds every chunk of the item and marks it ready", async () => {
    const item = createItem(t.db, { type: "note", title: "T", body: Array.from({ length: 800 }, (_, i) => `w${i}`).join(" ") });
    // Title "T" packs into its own chunk, then 800 words split into 375 + 375 + 50.
    expect(rechunkItem(t.db, item.id)).toBe(4);
    const job = enqueueJob(t.db, "embed", { itemId: item.id }, item.id);
    const handler = createEmbedHandler({ db: t.db, embed: createFakeEmbedProvider() });
    await handler(job);
    expect(countChunkVectors(t.db)).toBe(4);
    expect(getItem(t.db, item.id)?.status).toBe("ready");

    updateItem(t.db, item.id, { body: "short now" });
    rechunkItem(t.db, item.id);
    await handler(job);
    expect(countChunkVectors(t.db)).toBe(1);
  });

  it("marks the item ready without vectors when no provider is configured", async () => {
    const item = createItem(t.db, { type: "note", title: "T", body: "hello" });
    rechunkItem(t.db, item.id);
    const job = enqueueJob(t.db, "embed", { itemId: item.id }, item.id);
    await createEmbedHandler({ db: t.db, embed: null })(job);
    expect(countChunkVectors(t.db)).toBe(0);
    expect(getItem(t.db, item.id)?.status).toBe("ready");
  });

  it("throws when the item is missing", async () => {
    const job = enqueueJob(t.db, "embed", { itemId: 404 });
    await expect(createEmbedHandler({ db: t.db, embed: createFakeEmbedProvider() })(job)).rejects.toThrow(/not found/);
  });
});
