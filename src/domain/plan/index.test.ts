import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createTask, completeTask, dropTask, TaskError } from "@/domain/tasks";
import { addToPlan, carryOver, listPlan, removeFromPlan, reorderPlan, unfinished } from "./index";

describe("plan domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("adds, orders, and carries over", () => {
    const db = t.db;
    const a = createTask(db, { title: "A" });
    const b = createTask(db, { title: "B" });
    addToPlan(db, "2026-09-21", a.id);
    addToPlan(db, "2026-09-21", b.id);
    addToPlan(db, "2026-09-21", a.id);
    expect(listPlan(db, "2026-09-21").map((x) => x.id)).toEqual([a.id, b.id]);
    reorderPlan(db, "2026-09-21", [b.id, a.id]);
    expect(listPlan(db, "2026-09-21").map((x) => x.id)).toEqual([b.id, a.id]);
    completeTask(db, b.id);
    expect(unfinished(db, "2026-09-21").map((x) => x.id)).toEqual([a.id]);
    expect(carryOver(db, "2026-09-21", "2026-09-22")).toBe(1);
    expect(listPlan(db, "2026-09-22").map((x) => x.id)).toEqual([a.id]);
    removeFromPlan(db, "2026-09-22", a.id);
    expect(listPlan(db, "2026-09-22")).toEqual([]);
  });

  it("carries the plan's own order and a planId alongside each task", () => {
    const db = t.db;
    const a = createTask(db, { title: "A" });
    const b = createTask(db, { title: "B" });
    addToPlan(db, "2026-09-21", a.id);
    addToPlan(db, "2026-09-21", b.id);
    reorderPlan(db, "2026-09-21", [b.id]);
    const rows = listPlan(db, "2026-09-21");
    expect(rows.map((x) => [x.id, x.sortOrder])).toEqual([
      [b.id, 0],
      [a.id, 1],
    ]);
    expect(rows.every((x) => x.planId > 0)).toBe(true);
    expect(rows.map((x) => x.title)).toEqual(["B", "A"]);
  });

  it("leaves dropped tasks out of unfinished and skips what is already planned", () => {
    const db = t.db;
    const a = createTask(db, { title: "A" });
    const b = createTask(db, { title: "B" });
    addToPlan(db, "2026-09-21", a.id);
    addToPlan(db, "2026-09-21", b.id);
    dropTask(db, b.id);
    expect(unfinished(db, "2026-09-21").map((x) => x.id)).toEqual([a.id]);
    addToPlan(db, "2026-09-22", a.id);
    expect(carryOver(db, "2026-09-21", "2026-09-22")).toBe(0);
    expect(listPlan(db, "2026-09-22").map((x) => x.id)).toEqual([a.id]);
  });

  it("ignores a removal that is not on the plan and refuses an unknown task", () => {
    const db = t.db;
    expect(() => removeFromPlan(db, "2026-09-21", 999)).not.toThrow();
    expect(() => addToPlan(db, "2026-09-21", 999)).toThrow(TaskError);
    expect(listPlan(db, "2026-09-21")).toEqual([]);
    expect(unfinished(db, "2026-09-21")).toEqual([]);
    expect(carryOver(db, "2026-09-21", "2026-09-22")).toBe(0);
  });
});
