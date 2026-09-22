import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, listTagsWithCounts, setItemTags } from "./index";

describe("listTagsWithCounts", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("lists tags with counts, most used first", () => {
    const a = createItem(t.db, { type: "note", title: "A" });
    const b = createItem(t.db, { type: "note", title: "B" });
    const c = createItem(t.db, { type: "note", title: "C" });
    setItemTags(t.db, a.id, ["work"]);
    setItemTags(t.db, b.id, ["work"]);
    setItemTags(t.db, c.id, ["home"]);
    expect(listTagsWithCounts(t.db)).toEqual([
      { name: "work", count: 2 },
      { name: "home", count: 1 },
    ]);
  });

  it("keeps a tag no item uses, at the end, and breaks ties by name", () => {
    const a = createItem(t.db, { type: "note", title: "A" });
    setItemTags(t.db, a.id, ["beta", "alpha"]);
    setItemTags(t.db, a.id, ["alpha"]);
    expect(listTagsWithCounts(t.db)).toEqual([
      { name: "alpha", count: 1 },
      { name: "beta", count: 0 },
    ]);
  });
});
