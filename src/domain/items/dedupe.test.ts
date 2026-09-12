import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem } from "./index";
import { normalizeUrl, findLinkByUrl } from "./dedupe";

describe("normalizeUrl", () => {
  it("lowercases scheme and host, strips hash, trailing slash, and tracking params", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path/?utm_source=x&b=2&fbclid=1#frag")).toBe("https://example.com/Path?b=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/a/b/")).toBe("https://example.com/a/b");
    expect(normalizeUrl("https://example.com/a?ref=twitter&gclid=9&mc_cid=1&mc_eid=2")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/a?z=1&a=2")).toBe("https://example.com/a?z=1&a=2");
  });
});

describe("findLinkByUrl", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("finds an existing link by normalised url, ignoring archived ones and notes", () => {
    const link = createItem(t.db, { type: "link", title: "x", sourceUrl: "https://Example.com/post/?utm_campaign=a" });
    createItem(t.db, { type: "note", title: "n", body: "https://example.com/post" });
    expect(findLinkByUrl(t.db, "https://example.com/post#top")?.id).toBe(link.id);
    expect(findLinkByUrl(t.db, "https://example.com/other")).toBeUndefined();
    t.db.$client.prepare("UPDATE items SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), link.id);
    expect(findLinkByUrl(t.db, "https://example.com/post")).toBeUndefined();
  });
});
