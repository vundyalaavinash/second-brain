import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, type TestDb } from "@/test/db";

let t: TestDb;
afterEach(() => t?.cleanup());

/** Column names of a table, straight from SQLite's own catalogue. */
function columns(db: TestDb["db"], table: string): string[] {
  return db.all<{ name: string }>(sql`select name from pragma_table_info(${table})`).map((r) => r.name);
}

describe("migrations", () => {
  it("leaves a fresh database with task blocks and no block start on the task", () => {
    t = makeTestDb();
    expect(columns(t.db, "task_blocks")).toEqual(["id", "task_id", "starts_at", "minutes"]);
    const task = columns(t.db, "tasks");
    expect(task).toContain("session_minutes");
    expect(task).not.toContain("scheduled_at");
  });
});
