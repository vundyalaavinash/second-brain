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
});
