import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createItem,
  getItem,
  updateItem,
  mergeItemMeta,
  parseMeta,
  listItems,
  deleteItem,
  setItemTags,
  getItemTags,
  listTagNames,
  rechunkItem,
  getItemChunks,
  countInbox,
  fileItem,
  archiveItem,
  restoreItem,
  setItemPinned,
} from "./index";

describe("items domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("creates and reads an item with defaults", () => {
    const item = createItem(t.db, { type: "note", title: "Hello", body: "Body text" });
    expect(item.id).toBeGreaterThan(0);
    expect(item.status).toBe("pending");
    expect(item.extractedText).toBe("");
    expect(parseMeta(item)).toEqual({});
    expect(getItem(t.db, item.id)?.title).toBe("Hello");
    expect(getItem(t.db, 9999)).toBeUndefined();
  });

  it("updates fields and merges meta", () => {
    const item = createItem(t.db, { type: "link", title: "x", sourceUrl: "https://a.test", meta: { a: 1 } });
    const updated = updateItem(t.db, item.id, { title: "y", status: "ready", extractedText: "text" });
    expect(updated.title).toBe("y");
    expect(updated.status).toBe("ready");
    expect(updated.extractedText).toBe("text");
    expect(updated.updatedAt >= item.updatedAt).toBe(true);
    const merged = mergeItemMeta(t.db, item.id, { b: 2 });
    expect(parseMeta(merged)).toEqual({ a: 1, b: 2 });
    expect(() => updateItem(t.db, 9999, { title: "z" })).toThrow(/not found/);
  });

  it("lists newest first with type, status, and tag filters", () => {
    const a = createItem(t.db, { type: "note", title: "a" });
    const b = createItem(t.db, { type: "link", title: "b", sourceUrl: "https://b.test" });
    const c = createItem(t.db, { type: "note", title: "c", status: "ready" });
    setItemTags(t.db, a.id, ["Work"]);
    setItemTags(t.db, c.id, ["work", "idea"]);

    expect(listItems(t.db).map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    expect(listItems(t.db, { type: "note" }).map((i) => i.id)).toEqual([c.id, a.id]);
    expect(listItems(t.db, { status: "ready" }).map((i) => i.id)).toEqual([c.id]);
    expect(listItems(t.db, { tag: "work" }).map((i) => i.id)).toEqual([c.id, a.id]);
    expect(listItems(t.db, { tag: "idea" }).map((i) => i.id)).toEqual([c.id]);
    expect(listItems(t.db, { tag: "nothing" })).toEqual([]);
    expect(listItems(t.db, { limit: 1, offset: 1 }).map((i) => i.id)).toEqual([b.id]);
  });

  it("filters by created_at date range", () => {
    const old = createItem(t.db, { type: "note", title: "old" });
    const recent = createItem(t.db, { type: "note", title: "recent" });
    t.db.$client.prepare("UPDATE items SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", old.id);

    expect(listItems(t.db, { from: "2021-01-01" }).map((i) => i.id)).toEqual([recent.id]);
    expect(listItems(t.db, { to: "2020-12-31" }).map((i) => i.id)).toEqual([old.id]);
  });

  it("orders by what was touched last only when asked to", () => {
    const first = createItem(t.db, { type: "note", title: "first" });
    const second = createItem(t.db, { type: "note", title: "second" });
    t.db.$client.prepare("UPDATE items SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z", first.id);
    t.db.$client.prepare("UPDATE items SET created_at = ?, updated_at = ? WHERE id = ?").run("2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", second.id);

    expect(listItems(t.db).map((i) => i.id)).toEqual([second.id, first.id]);
    expect(listItems(t.db, { orderBy: "updated" }).map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("compares date filters against local calendar days, not UTC instants", () => {
    const item = createItem(t.db, { type: "note", title: "evening" });
    // A local-evening instant that would fall on the next UTC calendar day for timezones behind UTC.
    t.db.$client
      .prepare("UPDATE items SET created_at = ? WHERE id = ?")
      .run(new Date("2026-03-10T22:30:00").toISOString(), item.id);

    expect(listItems(t.db, { from: "2026-03-10", to: "2026-03-10" }).map((i) => i.id)).toEqual([item.id]);
    expect(listItems(t.db, { from: "2026-03-11" }).map((i) => i.id)).not.toContain(item.id);
  });

  it("normalizes, replaces, and lists tags", () => {
    const item = createItem(t.db, { type: "note", title: "t" });
    setItemTags(t.db, item.id, ["  Work ", "work", "Idea", ""]);
    expect(getItemTags(t.db, item.id)).toEqual(["idea", "work"]);
    setItemTags(t.db, item.id, ["other"]);
    expect(getItemTags(t.db, item.id)).toEqual(["other"]);
    expect(listTagNames(t.db)).toEqual(["idea", "other", "work"]);
  });

  it("rechunks title, body, and extracted text into searchable chunks", () => {
    const item = createItem(t.db, { type: "note", title: "Gardening", body: "Tomatoes need sun." });
    expect(rechunkItem(t.db, item.id)).toBe(1);
    expect(getItemChunks(t.db, item.id)[0].text).toBe("Gardening Tomatoes need sun.");
    const hit = t.db.$client.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'tomatoes'").all();
    expect(hit).toHaveLength(1);

    updateItem(t.db, item.id, { extractedText: Array.from({ length: 800 }, (_, i) => `word${i}`).join(" ") });
    // "Gardening" + "Tomatoes need sun." pack into one 4-word chunk, then 800 words become 375 + 375 + 50.
    expect(rechunkItem(t.db, item.id)).toBe(4);
    expect(getItemChunks(t.db, item.id).map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    expect(t.db.$client.prepare("SELECT count(*) AS c FROM chunks").get()).toEqual({ c: 4 });

    updateItem(t.db, item.id, { body: "", extractedText: "", title: "" });
    expect(rechunkItem(t.db, item.id)).toBe(0);
    expect(() => rechunkItem(t.db, 9999)).toThrow(/not found/);
  });

  it("deletes an item and cascades chunks, fts rows, and tags", () => {
    const item = createItem(t.db, { type: "note", title: "Bye", body: "farewell text" });
    setItemTags(t.db, item.id, ["x"]);
    rechunkItem(t.db, item.id);
    deleteItem(t.db, item.id);
    expect(getItem(t.db, item.id)).toBeUndefined();
    expect(t.db.$client.prepare("SELECT count(*) AS c FROM chunks").get()).toEqual({ c: 0 });
    expect(t.db.$client.prepare("SELECT count(*) AS c FROM item_tags").get()).toEqual({ c: 0 });
    expect(t.db.$client.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'farewell'").all()).toHaveLength(0);
  });

  it("files items, hides archived by default, and counts the inbox", () => {
    const inbox1 = createItem(t.db, { type: "note", title: "in1" });
    const inbox2 = createItem(t.db, { type: "note", title: "in2" });
    const homed = createItem(t.db, { type: "note", title: "homed", containerId: null });
    expect(countInbox(t.db)).toBe(3);

    // A real container is needed; insert one directly so this test does not depend on the containers domain.
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (kind, name, slug, created_at, updated_at) VALUES ('project', 'P', 'p', ?, ?)")
      .run(now, now);
    const containerId = (t.db.$client.prepare("SELECT id FROM containers WHERE slug = 'p'").get() as { id: number }).id;

    expect(fileItem(t.db, homed.id, containerId).containerId).toBe(containerId);
    expect(countInbox(t.db)).toBe(2);
    expect(listItems(t.db, { containerId }).map((i) => i.id)).toEqual([homed.id]);
    expect(listItems(t.db, { containerId: null }).map((i) => i.id)).toEqual([inbox2.id, inbox1.id]);

    expect(archiveItem(t.db, inbox1.id).archivedAt).toBeTruthy();
    expect(countInbox(t.db)).toBe(1);
    expect(listItems(t.db).map((i) => i.id)).toEqual([homed.id, inbox2.id]);
    expect(listItems(t.db, { includeArchived: true })).toHaveLength(3);
    expect(restoreItem(t.db, inbox1.id).archivedAt).toBeNull();
    expect(fileItem(t.db, homed.id, null).containerId).toBeNull();
    expect(() => fileItem(t.db, homed.id, 9999)).toThrow(/not found/);
  });

  it("onlyArchived returns exactly the archived items", () => {
    createItem(t.db, { type: "note", title: "a" });
    const b = createItem(t.db, { type: "note", title: "b" });
    createItem(t.db, { type: "note", title: "c" });
    archiveItem(t.db, b.id);
    expect(listItems(t.db, { onlyArchived: true }).map((i) => i.id)).toEqual([b.id]);
  });

  it("toggles pinned and 404s on an unknown id", () => {
    const item = createItem(t.db, { type: "link", title: "a", sourceUrl: "https://a.test" });
    expect(item.pinned).toBe(0);
    const pinned = setItemPinned(t.db, item.id, true);
    expect(pinned.pinned).toBe(1);
    const unpinned = setItemPinned(t.db, item.id, false);
    expect(unpinned.pinned).toBe(0);
    expect(() => setItemPinned(t.db, 9999, true)).toThrow(/not found/);
  });

  it("lists items filtered by pinned and by types", () => {
    const note = createItem(t.db, { type: "note", title: "n" });
    const link = createItem(t.db, { type: "link", title: "l", sourceUrl: "https://l.test" });
    const file = createItem(t.db, { type: "file", title: "f" });
    setItemPinned(t.db, link.id, true);

    expect(listItems(t.db, { pinned: true }).map((i) => i.id)).toEqual([link.id]);
    expect(listItems(t.db, { types: ["note", "link"] }).map((i) => i.id).sort()).toEqual([link.id, note.id].sort());
    expect(listItems(t.db, { types: ["file"] }).map((i) => i.id)).toEqual([file.id]);
  });

  it("orders pinned items first within a container, then falls back to newest first", () => {
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (kind, name, slug, created_at, updated_at) VALUES ('project', 'P', 'p', ?, ?)")
      .run(now, now);
    const containerId = (t.db.$client.prepare("SELECT id FROM containers WHERE slug = 'p'").get() as { id: number }).id;

    const a = createItem(t.db, { type: "note", title: "a", containerId });
    const b = createItem(t.db, { type: "note", title: "b", containerId });
    const c = createItem(t.db, { type: "note", title: "c", containerId });
    setItemPinned(t.db, b.id, true);

    expect(listItems(t.db, { containerId }).map((i) => i.id)).toEqual([b.id, c.id, a.id]);
    // Without a containerId filter, pinned status does not affect ordering.
    expect(listItems(t.db).map((i) => i.id)).toEqual([c.id, b.id, a.id]);
  });
});
