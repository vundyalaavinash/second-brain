import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { sql } from "drizzle-orm";
import { makeTestDb, type TestDb } from "@/test/db";

let t: TestDb;
afterEach(() => t?.cleanup());

/** Column names of a table, straight from SQLite's own catalogue. */
function columns(db: TestDb["db"], table: string): string[] {
  return db.all<{ name: string }>(sql`select name from pragma_table_info(${table})`).map((r) => r.name);
}

/** The migration tags in the order the journal runs them; the copy is only right in that order. */
function journalTags(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

/** Applies one migration file the way drizzle's migrator does: statement by statement. */
function applyMigration(sqlite: Database.Database, tag: string): void {
  const text = fs.readFileSync(path.join(process.cwd(), "drizzle", `${tag}.sql`), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

describe("migrations", () => {
  it("leaves a fresh database with task blocks and no block start on the task", () => {
    t = makeTestDb();
    expect(columns(t.db, "task_blocks")).toEqual(["id", "task_id", "starts_at", "minutes"]);
    const task = columns(t.db, "tasks");
    expect(task).toContain("session_minutes");
    expect(task).not.toContain("scheduled_at");
  });

  // The upgrade a database that was already in use goes through: 0011 copies every scheduled
  // task into a session before it drops the column those times lived in. Run here against a
  // raw connection opened the way `openDatabase` opens one, so the drop is exercised against
  // the same SQLite build production runs on.
  it("copies each scheduled task into a session before dropping the column", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migrate-"));
    const sqlite = new Database(path.join(dir, "old.db"));
    try {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      sqliteVec.load(sqlite);
      const tags = journalTags();
      const upTo = tags.indexOf("0011_task_blocks");
      expect(upTo).toBeGreaterThan(0);
      for (const tag of tags.slice(0, upTo)) applyMigration(sqlite, tag);

      // The database as it stood before the upgrade: one estimated task blocked out, one with
      // a time but no estimate, and one that was never given a time at all.
      const now = "2026-09-20T09:00:00.000Z";
      const insert = sqlite.prepare(
        "INSERT INTO tasks (title, estimate_minutes, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run("Long one", 90, "2026-09-21T09:00:00", now, now);
      insert.run("Unestimated", null, "2026-09-21T14:00:00", now, now);
      insert.run("Never scheduled", 30, null, now, now);
      expect(sqlite.prepare("SELECT count(*) AS c FROM tasks").get()).toEqual({ c: 3 });

      applyMigration(sqlite, "0011_task_blocks");

      const blocks = sqlite.prepare("SELECT task_id, starts_at, minutes FROM task_blocks ORDER BY starts_at").all();
      // The estimate becomes the session's length; a task nobody estimated takes the default 25.
      expect(blocks).toEqual([
        { task_id: 1, starts_at: "2026-09-21T09:00:00", minutes: 90 },
        { task_id: 2, starts_at: "2026-09-21T14:00:00", minutes: 25 },
      ]);
      const names = (sqlite.prepare("SELECT name FROM pragma_table_info('tasks')").all() as { name: string }[]).map((r) => r.name);
      expect(names).not.toContain("scheduled_at");
      expect(names).toContain("session_minutes");
    } finally {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
