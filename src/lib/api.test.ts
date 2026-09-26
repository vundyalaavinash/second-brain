import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, mergeItemMeta } from "@/domain/items";
import { serializeItem } from "./api";

describe("serializeItem", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("carries a stored distillation", () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: "x" });
    mergeItemMeta(t.db, item.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" } });
    const dto = serializeItem(t.db, getItem(t.db, item.id)!);
    expect(dto.distillation).toEqual({ gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" });
  });

  it("carries undefined when the item has no distillation", () => {
    const item = createItem(t.db, { type: "note", title: "Note", body: "x" });
    const dto = serializeItem(t.db, item);
    expect(dto.distillation).toBeUndefined();
  });
});
