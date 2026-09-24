import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { addBlock, listBlocks } from "@/domain/blocks";
import { createTask, completeTask, dropTask, TaskError } from "@/domain/tasks";
import { addToPlan, carryOver, listPlan, removeFromPlan, reorderPlan, sortPlanByTime, unfinished } from "./index";

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

  it("clears the day's sessions when the task leaves the plan or is carried over", () => {
    const a = createTask(t.db, { title: "A" });
    const b = createTask(t.db, { title: "B" });
    addBlock(t.db, { taskId: a.id, startsAt: "2026-09-23T10:00:00", minutes: 45 });
    addBlock(t.db, { taskId: b.id, startsAt: "2026-09-23T11:00:00", minutes: 45 });
    addToPlan(t.db, "2026-09-23", a.id);
    addToPlan(t.db, "2026-09-23", b.id);
    removeFromPlan(t.db, "2026-09-23", a.id);
    expect(listBlocks(t.db, { taskId: a.id })).toEqual([]);
    expect(carryOver(t.db, "2026-09-23", "2026-09-24")).toBe(1);
    expect(listBlocks(t.db, { taskId: b.id })).toEqual([]);
  });

  it("leaves a block on another day alone when the task is unplanned", () => {
    const mon = "2026-09-21";
    const tue = "2026-09-22";
    // One task on both days, blocked on Tuesday: Monday's plan has no claim on that hour.
    const a = createTask(t.db, { title: "A" });
    addBlock(t.db, { taskId: a.id, startsAt: `${tue}T10:00:00`, minutes: 45 });
    addToPlan(t.db, mon, a.id);
    addToPlan(t.db, tue, a.id);
    removeFromPlan(t.db, mon, a.id);
    expect(listBlocks(t.db, { taskId: a.id }).map((b) => b.startsAt)).toEqual([`${tue}T10:00:00`]);
    removeFromPlan(t.db, tue, a.id);
    expect(listBlocks(t.db, { taskId: a.id })).toEqual([]);
  });

  it("carries a task over without touching a block it holds on another day", () => {
    const mon = "2026-09-21";
    const wed = "2026-09-23";
    const a = createTask(t.db, { title: "A" });
    addBlock(t.db, { taskId: a.id, startsAt: `${wed}T14:00:00`, minutes: 60 });
    addToPlan(t.db, mon, a.id);
    expect(carryOver(t.db, mon, "2026-09-22")).toBe(1);
    expect(listBlocks(t.db, { taskId: a.id }).map((b) => b.startsAt)).toEqual([`${wed}T14:00:00`]);
  });

  it("sorts the plan by the first session, unblocked rows keeping their order at the end", () => {
    const late = createTask(t.db, { title: "Late" });
    const early = createTask(t.db, { title: "Early" });
    addBlock(t.db, { taskId: late.id, startsAt: "2026-09-23T15:00:00", minutes: 30 });
    addBlock(t.db, { taskId: early.id, startsAt: "2026-09-23T09:00:00", minutes: 30 });
    // A later session of the early task must not push it down the plan.
    addBlock(t.db, { taskId: early.id, startsAt: "2026-09-23T16:00:00", minutes: 30 });
    const loose1 = createTask(t.db, { title: "Loose 1" });
    const loose2 = createTask(t.db, { title: "Loose 2" });
    for (const id of [loose1.id, late.id, loose2.id, early.id]) addToPlan(t.db, "2026-09-23", id);
    expect(sortPlanByTime(t.db, "2026-09-23").map((p) => p.title)).toEqual(["Early", "Late", "Loose 1", "Loose 2"]);
  });
});
