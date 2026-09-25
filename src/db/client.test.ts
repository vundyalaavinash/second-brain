import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import * as safety from "@/db/safety";

describe("openDatabase", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  // The test suite opens hundreds of :memory: databases; a snapshot check per open would be
  // both slow and pointless, since there is no file for a migration to endanger.
  it("takes no snapshot and reads no migration state for :memory:", async () => {
    const pendingSpy = vi.spyOn(safety, "pendingMigrations");
    const snapshotSpy = vi.spyOn(safety, "snapshotBeforeMigrate");
    const { openDatabase } = await import("@/db/client");
    const db = openDatabase(":memory:");
    try {
      expect(pendingSpy).not.toHaveBeenCalled();
      expect(snapshotSpy).not.toHaveBeenCalled();
    } finally {
      db.$client.close();
      pendingSpy.mockRestore();
      snapshotSpy.mockRestore();
    }
  });

  // A database you cannot open is worse than one opened without a snapshot -- a full disk, a
  // permissions slip, a locked file must never be the reason boot fails.
  it("survives a snapshot that fails, and still opens the database", async () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const dir = path.dirname(file);

    // Force the "something is pending" branch on a database that is genuinely fully migrated,
    // so drizzle's own migrate() (which reads __drizzle_migrations itself, unaffected by this
    // mock) has nothing real to do -- the only thing under test is the snapshot's own failure.
    const pendingSpy = vi.spyOn(safety, "pendingMigrations").mockReturnValue(["0000_fake_pending"]);
    // A plain file sitting where the backups directory needs to be created means
    // fs.mkdirSync(..., { recursive: true }) throws inside the snapshot.
    fs.writeFileSync(path.join(dir, "backups"), "not a directory");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { openDatabase } = await import("@/db/client");
    const db = openDatabase(file);
    try {
      expect(db.$client.prepare("SELECT count(*) AS c FROM items").get()).toEqual({ c: 0 });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      db.$client.close();
      errorSpy.mockRestore();
      pendingSpy.mockRestore();
    }
  });

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

  it("has containers, people, and item homes", () => {
    t = makeTestDb();
    const cols = (table: string) =>
      (t.db.$client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("containers")).toEqual(
      expect.arrayContaining(["id", "kind", "name", "slug", "status", "goal", "deadline", "standard", "category", "next_steps", "sort_order", "archived_at"]),
    );
    expect(cols("people")).toEqual(expect.arrayContaining(["id", "name", "slug", "profile"]));
    expect(cols("item_people")).toEqual(expect.arrayContaining(["item_id", "person_id"]));
    expect(cols("items")).toEqual(expect.arrayContaining(["container_id", "archived_at"]));
  });

  it("sets items.container_id to NULL when the referenced container is deleted", () => {
    t = makeTestDb();
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (id, kind, name, slug, created_at, updated_at) VALUES (1, 'project', 'P', 'p', ?, ?)")
      .run(now, now);
    t.db.$client
      .prepare("INSERT INTO items (id, type, title, container_id, created_at, updated_at) VALUES (1, 'note', 'T', 1, ?, ?)")
      .run(now, now);
    t.db.$client.prepare("DELETE FROM containers WHERE id = 1").run();
    const row = t.db.$client.prepare("SELECT container_id FROM items WHERE id = 1").get() as { container_id: number | null };
    expect(row.container_id).toBeNull();
  });
});
