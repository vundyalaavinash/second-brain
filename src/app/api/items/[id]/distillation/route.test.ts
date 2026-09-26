import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { createItem, getItem, mergeItemMeta, parseMeta } from "@/domain/items";
import type { Distillation } from "@/domain/distill";

let dir: string;
let distillationRoute: typeof import("./route");

function req(body: unknown) {
  return new Request("http://localhost/api/items/1/distillation", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  distillationRoute = await import("./route");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("PATCH /api/items/[id]/distillation", () => {
  it("keeps a pending distillation", async () => {
    const db = getDb();
    const item = createItem(db, { type: "note", title: "Note", body: "x" });
    mergeItemMeta(db, item.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" } });
    const res = await distillationRoute.PATCH(req({ status: "kept" }), params(String(item.id)));
    expect(res.status).toBe(200);
    const meta = parseMeta<{ distillation: Distillation }>(getItem(db, item.id)!);
    expect(meta.distillation.status).toBe("kept");
  });

  it("dismisses a pending distillation", async () => {
    const db = getDb();
    const item = createItem(db, { type: "note", title: "Note", body: "x" });
    mergeItemMeta(db, item.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" } });
    await distillationRoute.PATCH(req({ status: "dismissed" }), params(String(item.id)));
    const meta = parseMeta<{ distillation: Distillation }>(getItem(db, item.id)!);
    expect(meta.distillation.status).toBe("dismissed");
  });

  it("404s for an item with no distillation to decide on", async () => {
    const db = getDb();
    const item = createItem(db, { type: "note", title: "Note", body: "x" });
    const res = await distillationRoute.PATCH(req({ status: "kept" }), params(String(item.id)));
    expect(res.status).toBe(404);
  });

  it("404s for an item that does not exist", async () => {
    const res = await distillationRoute.PATCH(req({ status: "kept" }), params("999999"));
    expect(res.status).toBe(404);
  });

  it("rejects an invalid status", async () => {
    const db = getDb();
    const item = createItem(db, { type: "note", title: "Note", body: "x" });
    mergeItemMeta(db, item.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" } });
    const res = await distillationRoute.PATCH(req({ status: "nonsense" }), params(String(item.id)));
    expect(res.status).toBe(400);
  });

  it("returns the serialized item, with its distillation carrying the new status", async () => {
    const db = getDb();
    const item = createItem(db, { type: "note", title: "Note", body: "x" });
    mergeItemMeta(db, item.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" } });
    const res = await distillationRoute.PATCH(req({ status: "kept" }), params(String(item.id)));
    const body = (await res.json()) as { id: number; distillation?: Distillation };
    expect(body.id).toBe(item.id);
    expect(body.distillation?.status).toBe("kept");
  });
});
