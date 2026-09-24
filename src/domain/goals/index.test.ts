import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { openDatabase } from "@/db/client";
import type { DB } from "@/db/client";
import { dbPath } from "@/lib/paths";
import { createContainer } from "@/domain/containers";
import { createTask, completeTask, dropTask } from "@/domain/tasks";
import { createGoal, setGoalLinks, measureGoals, goalsWithMeasure, closeGoal, reopenGoal, goalsForContainer, recentCloses } from "./index";

const dir = makeTempDataDir();
let db: DB;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  db = openDatabase(dbPath());
  db.run("delete from goal_links");
  db.run("delete from goals");
  db.run("delete from tasks");
  db.run("delete from containers");
});

const TODAY = "2026-09-24";

function project(name: string) {
  return createContainer(db, { kind: "project", name });
}

describe("goal measure", () => {
  it("takes its percent from the tasks of every linked container", () => {
    const a = project("Ship the API");
    const b = project("Write the docs");
    const goal = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(db, goal.id, [a.id, b.id]);
    completeTask(db, createTask(db, { title: "one", containerId: a.id }).id);
    completeTask(db, createTask(db, { title: "two", containerId: b.id }).id);
    createTask(db, { title: "three", containerId: b.id });

    const m = measureGoals(db, [goal.id], TODAY).get(goal.id)!;
    expect(m).toMatchObject({ open: 1, done: 2, total: 3, percent: 67 });
  });

  it("counts a dropped task as neither open nor done", () => {
    const a = project("Ship the API");
    const goal = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(db, goal.id, [a.id]);
    dropTask(db, createTask(db, { title: "one", containerId: a.id }).id);
    expect(measureGoals(db, [goal.id], TODAY).get(goal.id)).toMatchObject({ open: 0, done: 0, total: 0, percent: 0 });
  });

  it("is stalled with no links at all", () => {
    const goal = createGoal(db, { title: "Learn Rust", horizon: "year", targetDate: "2026-12-31" });
    expect(measureGoals(db, [goal.id], TODAY).get(goal.id)).toMatchObject({ stalled: true, movement: 0, lastClosedAt: null });
  });

  it("counts only closes inside the movement window", () => {
    const a = project("Ship the API");
    const goal = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(db, goal.id, [a.id]);
    const recent = createTask(db, { title: "recent", containerId: a.id });
    const old = createTask(db, { title: "old", containerId: a.id });
    completeTask(db, recent.id);
    completeTask(db, old.id);
    db.run(`update tasks set completed_at = '2026-09-01T09:00:00.000Z' where id = ${old.id}`);
    db.run(`update tasks set completed_at = '2026-09-22T09:00:00.000Z' where id = ${recent.id}`);

    const m = measureGoals(db, [goal.id], TODAY).get(goal.id)!;
    expect(m.movement).toBe(1);
    expect(m.stalled).toBe(false);
  });

  it("is stalled on the day after the window, not on its last day", () => {
    const a = project("Ship the API");
    const goal = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(db, goal.id, [a.id]);
    const t = createTask(db, { title: "one", containerId: a.id });
    completeTask(db, t.id);
    // The boundary: a close exactly STALLED_DAYS ago still counts as motion.
    db.run(`update tasks set completed_at = '2026-09-10T09:00:00.000Z' where id = ${t.id}`);
    expect(measureGoals(db, [goal.id], TODAY).get(goal.id)!.stalled).toBe(false);
    db.run(`update tasks set completed_at = '2026-09-09T09:00:00.000Z' where id = ${t.id}`);
    expect(measureGoals(db, [goal.id], TODAY).get(goal.id)!.stalled).toBe(true);
  });
});

describe("goal lifecycle", () => {
  it("rejects a target date that is not a day", () => {
    expect(() => createGoal(db, { title: "x", horizon: "year", targetDate: "next year" })).toThrow(/target date/i);
  });

  it("closing records the outcome and the time, reopening clears both", () => {
    const g = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    const hit = closeGoal(db, g.id, "hit");
    expect(hit.status).toBe("hit");
    expect(hit.closedAt).not.toBeNull();
    const back = reopenGoal(db, g.id);
    expect(back).toMatchObject({ status: "active", closedAt: null });
  });

  it("links replace rather than accumulate, and survive a deleted container", () => {
    const a = project("A");
    const b = project("B");
    const g = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(db, g.id, [a.id, b.id]);
    setGoalLinks(db, g.id, [b.id]);
    expect(goalsForContainer(db, a.id)).toEqual([]);
    expect(goalsForContainer(db, b.id).map((x) => x.id)).toEqual([g.id]);
    db.run(`delete from containers where id = ${b.id}`);
    expect(goalsForContainer(db, b.id)).toEqual([]);
    expect(measureGoals(db, [g.id], TODAY).get(g.id)).toMatchObject({ total: 0 });
  });

  it("refuses a link to a container that does not exist", () => {
    const g = createGoal(db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    expect(() => setGoalLinks(db, g.id, [9999])).toThrow(/container/i);
  });

  it("lists active goals by nearest target date and names the ones most recently closed against", () => {
    const a = project("A");
    const soon = createGoal(db, { title: "Soon", horizon: "quarter", targetDate: "2026-10-01" });
    createGoal(db, { title: "Later", horizon: "year", targetDate: "2026-12-31" });
    setGoalLinks(db, soon.id, [a.id]);
    const t = createTask(db, { title: "one", containerId: a.id });
    completeTask(db, t.id);
    const list = goalsWithMeasure(db, { status: "active" }, TODAY);
    expect(list.map((g) => g.title)).toEqual(["Soon", "Later"]);
    expect(list[0].containers.map((c) => c.name)).toEqual(["A"]);
    expect(recentCloses(db, soon.id, 5).map((r) => r.title)).toEqual(["one"]);
  });
});
