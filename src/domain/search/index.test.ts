import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, rechunkItem, setItemTags } from "@/domain/items";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import { enqueueJob } from "@/jobs/queue";
import { createEmbedHandler } from "@/jobs/handlers/embed";
import { buildFtsQuery, ftsSearch } from "./fts";
import { search, makeSnippet } from "./index";

async function seed(t: TestDb) {
  const embed = createFakeEmbedProvider();
  const handler = createEmbedHandler({ db: t.db, embed });
  const mk = async (title: string, body: string, type: "note" | "link" = "note", tags: string[] = []) => {
    const item = createItem(t.db, { type, title, body, sourceUrl: type === "link" ? "https://x.test" : undefined });
    if (tags.length) setItemTags(t.db, item.id, tags);
    rechunkItem(t.db, item.id);
    await handler(enqueueJob(t.db, "embed", { itemId: item.id }, item.id));
    return item;
  };
  const tomato = await mk("Tomato care", "Tomatoes need full sun and regular water in the garden.", "note", ["garden"]);
  const finance = await mk("Q3 numbers", "Quarterly revenue report shows growth in subscriptions.", "link", ["work"]);
  const garden = await mk("Garden layout", "Raised beds along the fence, tomato and basil together.", "note", ["garden"]);
  return { embed, tomato, finance, garden };
}

describe("search", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("builds a tolerant FTS query", () => {
    expect(buildFtsQuery("Tomato garden!")).toBe('"tomato"* OR "garden"*');
    expect(buildFtsQuery("  ")).toBeNull();
    expect(buildFtsQuery('"quoted" (term)')).toBe('"quoted"* OR "term"*');
  });

  it("finds by keyword without an embedding provider", async () => {
    const { tomato } = await seed(t);
    const results = await search(t.db, null, "tomatoes water");
    expect(results[0].item.id).toBe(tomato.id);
    expect(results[0].snippet).toMatch(/Tomatoes need full sun/);
  });

  it("finds semantically related items when embeddings exist", async () => {
    const { embed, finance } = await seed(t);
    const results = await search(t.db, embed, "revenue subscriptions growth");
    expect(results[0].item.id).toBe(finance.id);
  });

  it("ranks an item hit by both signals first and groups by item", async () => {
    const { embed, tomato, garden } = await seed(t);
    const results = await search(t.db, embed, "tomato garden");
    const ids = results.map((r) => r.item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2).sort()).toEqual([tomato.id, garden.id].sort());
  });

  it("applies type, tag, and date filters", async () => {
    const { embed, finance, tomato } = await seed(t);
    // Vector search always returns nearest neighbours, so filters are asserted as exclusions.
    const links = await search(t.db, embed, "tomato", { type: "link" });
    expect(links.every((r) => r.item.type === "link")).toBe(true);
    expect(links.map((r) => r.item.id)).not.toContain(tomato.id);
    expect((await search(t.db, embed, "report", { tag: "work" })).map((r) => r.item.id)).toEqual([finance.id]);
    const work = await search(t.db, embed, "tomato", { tag: "work" });
    expect(work.map((r) => r.item.id)).not.toContain(tomato.id);
    t.db.$client.prepare("UPDATE items SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(tomato.id);
    const dated = await search(t.db, embed, "tomato", { from: "2021-01-01" });
    expect(dated.map((r) => r.item.id)).not.toContain(tomato.id);
    const old = await search(t.db, embed, "tomato", { to: "2020-12-31" });
    expect(old.map((r) => r.item.id)).toEqual([tomato.id]);
  });

  it("returns nothing for an empty query and respects the limit", async () => {
    const { embed } = await seed(t);
    expect(await search(t.db, embed, "   ")).toEqual([]);
    expect(await search(t.db, embed, "tomato garden", {}, 1)).toHaveLength(1);
    expect(ftsSearch(t.db, "tomato", { limit: 1 })).toHaveLength(1);
  });

  it("makes a snippet around the first matching term", () => {
    const text = `${"a ".repeat(200)}needle in the haystack ${"b ".repeat(200)}`;
    const s = makeSnippet(text, "haystack", 60);
    expect(s).toMatch(/needle in the haystack/);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(makeSnippet("short text", "zzz", 60)).toBe("short text");
  });
});
