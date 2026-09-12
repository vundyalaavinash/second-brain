import { describe, it, expect, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";

describe("openDatabase", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates regular tables, virtual tables, and loads sqlite-vec", () => {
    t = makeTestDb();
    const names = t.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const expected of ["items", "tags", "item_tags", "chunks", "jobs", "settings", "chunks_fts", "chunks_vec"]) {
      expect(names).toContain(expected);
    }
    const v = t.db.$client.prepare("SELECT vec_version() AS v").get() as { v: string };
    expect(v.v).toMatch(/^v\d/);
  });

  it("keeps chunks_fts in sync through triggers", () => {
    t = makeTestDb();
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO items (type, title, created_at, updated_at) VALUES ('note', 'T', ?, ?)")
      .run(now, now);
    t.db.$client.prepare("INSERT INTO chunks (item_id, ordinal, text) VALUES (1, 0, 'quantum gardening tips')").run();
    const hit = t.db.$client.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'gardening'").all();
    expect(hit).toHaveLength(1);
    t.db.$client.prepare("DELETE FROM chunks WHERE id = 1").run();
    const gone = t.db.$client.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'gardening'").all();
    expect(gone).toHaveLength(0);
  });

  it("is idempotent when opened twice on the same file", async () => {
    t = makeTestDb();
    const { openDatabase } = await import("@/db/client");
    const again = openDatabase(t.db.$client.name);
    expect(again.$client.prepare("SELECT count(*) AS c FROM items").get()).toEqual({ c: 0 });
    again.$client.close();
  });
});
