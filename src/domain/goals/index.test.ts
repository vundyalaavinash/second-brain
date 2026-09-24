import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { addDays } from "@/domain/activity";
import { createContainer } from "@/domain/containers";
import { createTask, completeTask, dropTask } from "@/domain/tasks";
import {
  createGoal,
  updateGoal,
  deleteGoal,
  getGoal,
  listGoals,
  setGoalLinks,
  goalLinksFor,
  goalsForContainer,
  goalRefsByContainer,
  measureGoals,
  goalsWithMeasure,
  closeGoal,
  reopenGoal,
  recentCloses,
  MOVEMENT_DAYS,
  STALLED_DAYS,
} from "./index";

const TODAY = "2026-09-24";

/**
 * A midday UTC instant on `day`. Local-day boundaries in `measureGoals` are read with
 * `localDay`, which depends on the machine's own zone; noon UTC is the one instant whose local
 * day is `day` everywhere from UTC-12 to UTC+11:59, so a boundary test holds on any machine.
 */
function noon(day: string): string {
  return `${day}T12:00:00.000Z`;
}

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
});
afterEach(() => t.cleanup());

function project(name: string) {
  return createContainer(t.db, { kind: "project", name });
}

describe("goal measure", () => {
  it("takes its percent from the tasks of every linked container", () => {
    const a = project("Ship the API");
    const b = project("Write the docs");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [a.id, b.id]);
    completeTask(t.db, createTask(t.db, { title: "one", containerId: a.id }).id);
    completeTask(t.db, createTask(t.db, { title: "two", containerId: b.id }).id);
    createTask(t.db, { title: "three", containerId: b.id });

    const m = measureGoals(t.db, [goal.id], TODAY).get(goal.id)!;
    expect(m).toMatchObject({ open: 1, done: 2, total: 3, percent: 67 });
  });

  it("counts a dropped task as neither open nor done", () => {
    const a = project("Ship the API");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [a.id]);
    dropTask(t.db, createTask(t.db, { title: "one", containerId: a.id }).id);
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)).toMatchObject({ open: 0, done: 0, total: 0, percent: 0 });
  });

  it("is stalled with no links at all", () => {
    const goal = createGoal(t.db, { title: "Learn Rust", horizon: "year", targetDate: "2026-12-31" });
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)).toMatchObject({ stalled: true, movement: 0, lastClosedAt: null });
  });

  it("counts only closes inside the movement window", () => {
    const a = project("Ship the API");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [a.id]);
    const recent = createTask(t.db, { title: "recent", containerId: a.id });
    const old = createTask(t.db, { title: "old", containerId: a.id });
    completeTask(t.db, recent.id);
    completeTask(t.db, old.id);
    t.db.run(`update tasks set completed_at = '${noon("2026-09-01")}' where id = ${old.id}`);
    t.db.run(`update tasks set completed_at = '${noon("2026-09-22")}' where id = ${recent.id}`);

    const m = measureGoals(t.db, [goal.id], TODAY).get(goal.id)!;
    expect(m.movement).toBe(1);
    expect(m.stalled).toBe(false);
  });

  it("counts a close exactly MOVEMENT_DAYS ago as motion, and one day older as none", () => {
    const a = project("Ship the API");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [a.id]);
    const task = createTask(t.db, { title: "one", containerId: a.id });
    completeTask(t.db, task.id);
    // Inclusive: a close on the boundary day itself still counts as motion.
    t.db.run(`update tasks set completed_at = '${noon(addDays(TODAY, -MOVEMENT_DAYS))}' where id = ${task.id}`);
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)!.movement).toBe(1);
    t.db.run(`update tasks set completed_at = '${noon(addDays(TODAY, -MOVEMENT_DAYS - 1))}' where id = ${task.id}`);
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)!.movement).toBe(0);
  });

  it("is stalled on the day after the window, not on its last day", () => {
    const a = project("Ship the API");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [a.id]);
    const task = createTask(t.db, { title: "one", containerId: a.id });
    completeTask(t.db, task.id);
    // The boundary: a close exactly STALLED_DAYS ago still counts as motion.
    t.db.run(`update tasks set completed_at = '${noon(addDays(TODAY, -STALLED_DAYS))}' where id = ${task.id}`);
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)!.stalled).toBe(false);
    t.db.run(`update tasks set completed_at = '${noon(addDays(TODAY, -STALLED_DAYS - 1))}' where id = ${task.id}`);
    expect(measureGoals(t.db, [goal.id], TODAY).get(goal.id)!.stalled).toBe(true);
  });
});

describe("goal lifecycle", () => {
  it("rejects a target date that is not a day", () => {
    expect(() => createGoal(t.db, { title: "x", horizon: "year", targetDate: "next year" })).toThrow(/target date/i);
  });

  it("closing records the outcome and the time, reopening clears both", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    const hit = closeGoal(t.db, g.id, "hit");
    expect(hit.status).toBe("hit");
    expect(hit.closedAt).not.toBeNull();
    const back = reopenGoal(t.db, g.id);
    expect(back).toMatchObject({ status: "active", closedAt: null });
  });

  it("routes a patched status through close/reopen, so status and closedAt always move together", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    const hit = updateGoal(t.db, g.id, { status: "hit" });
    expect(hit.status).toBe("hit");
    expect(hit.closedAt).not.toBeNull();
    // A title change and a reopen in the same patch both take: the invariant is enforced, not
    // a reason to drop the rest of the patch.
    const reopened = updateGoal(t.db, g.id, { title: "Launch v2.1", status: "active" });
    expect(reopened).toMatchObject({ title: "Launch v2.1", status: "active", closedAt: null });
  });

  it("deletes a goal, and 404s on a missing one for get, update and delete", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    deleteGoal(t.db, g.id);
    expect(getGoal(t.db, g.id)).toBeUndefined();
    expect(() => deleteGoal(t.db, g.id)).toThrow(/not found/i);
    expect(() => updateGoal(t.db, g.id, { title: "x" })).toThrow(/not found/i);
  });

  it("links replace rather than accumulate, and survive a deleted container", () => {
    const a = project("A");
    const b = project("B");
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, g.id, [a.id, b.id]);
    setGoalLinks(t.db, g.id, [b.id]);
    expect(goalsForContainer(t.db, a.id)).toEqual([]);
    expect(goalsForContainer(t.db, b.id).map((x) => x.id)).toEqual([g.id]);
    expect(goalLinksFor(t.db, [g.id]).get(g.id)!.map((c) => c.id)).toEqual([b.id]);
    // A real task in b, so the measure below only reads 0 if the deletion genuinely drops the
    // work rather than the count being 0 because nothing was ever there to lose.
    completeTask(t.db, createTask(t.db, { title: "one", containerId: b.id }).id);
    t.db.run(`delete from containers where id = ${b.id}`);
    expect(goalsForContainer(t.db, b.id)).toEqual([]);
    expect(measureGoals(t.db, [g.id], TODAY).get(g.id)).toMatchObject({ total: 0 });
  });

  it("goalsForContainer defaults to active goals, same as goalRefsByContainer, with includeClosed as the explicit opt-in", () => {
    const a = project("A");
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, g.id, [a.id]);
    closeGoal(t.db, g.id, "hit");
    expect(goalsForContainer(t.db, a.id)).toEqual([]);
    expect(goalsForContainer(t.db, a.id, { includeClosed: true }).map((x) => x.id)).toEqual([g.id]);
  });

  it("refuses a link to a container that does not exist", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    expect(() => setGoalLinks(t.db, g.id, [9999])).toThrow(/container/i);
  });

  it("refuses a link to a resource — design §3.1 allows only projects and areas", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    const resource = createContainer(t.db, { kind: "resource", name: "Reference notes" });
    expect(() => setGoalLinks(t.db, g.id, [resource.id])).toThrow(/projects and areas/i);
    // A mixed set fails whole, same as any other invalid link — no partial write.
    const p = project("A project");
    expect(() => setGoalLinks(t.db, g.id, [p.id, resource.id])).toThrow(/projects and areas/i);
    expect(goalLinksFor(t.db, [g.id]).get(g.id)).toEqual([]);
  });

  it("lists goals by status, and updateGoal patches only the given fields", () => {
    const g = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    createGoal(t.db, { title: "Learn Rust", horizon: "year", targetDate: "2026-12-31" });
    closeGoal(t.db, g.id, "hit");
    expect(listGoals(t.db, { status: "hit" }).map((x) => x.title)).toEqual(["Launch v2"]);
    expect(listGoals(t.db).map((x) => x.title).sort()).toEqual(["Launch v2", "Learn Rust"]);
    const patched = updateGoal(t.db, g.id, { notes: "shipped" });
    expect(patched).toMatchObject({ title: "Launch v2", notes: "shipped", status: "hit" });
  });

  it("badges a container with only its active goals, never a closed one", () => {
    const a = project("A");
    const active = createGoal(t.db, { title: "Active goal", horizon: "quarter", targetDate: "2026-12-31" });
    const closed = createGoal(t.db, { title: "Closed goal", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, active.id, [a.id]);
    setGoalLinks(t.db, closed.id, [a.id]);
    closeGoal(t.db, closed.id, "hit");
    expect(goalRefsByContainer(t.db, [a.id]).get(a.id)!.map((g) => g.title)).toEqual(["Active goal"]);
  });

  it("lists active goals by nearest target date and names the ones most recently closed against", () => {
    const a = project("A");
    const soon = createGoal(t.db, { title: "Soon", horizon: "quarter", targetDate: "2026-10-01" });
    createGoal(t.db, { title: "Later", horizon: "year", targetDate: "2026-12-31" });
    setGoalLinks(t.db, soon.id, [a.id]);
    const task = createTask(t.db, { title: "one", containerId: a.id });
    completeTask(t.db, task.id);
    const list = goalsWithMeasure(t.db, { status: "active" }, TODAY);
    expect(list.map((g) => g.title)).toEqual(["Soon", "Later"]);
    expect(list[0].containers.map((c) => c.name)).toEqual(["A"]);
    expect(recentCloses(t.db, soon.id, 5).map((r) => r.title)).toEqual(["one"]);
  });

  it("orders a mixed, unfiltered list: active by soonest target date, closed by most recently decided", () => {
    createGoal(t.db, { title: "ActiveSoon", horizon: "quarter", targetDate: "2026-10-01" });
    createGoal(t.db, { title: "ActiveLate", horizon: "year", targetDate: "2026-12-31" });
    const closedOld = createGoal(t.db, { title: "ClosedOld", horizon: "quarter", targetDate: "2026-11-01" });
    const closedNew = createGoal(t.db, { title: "ClosedNew", horizon: "quarter", targetDate: "2026-11-15" });
    closeGoal(t.db, closedOld.id, "hit");
    closeGoal(t.db, closedNew.id, "hit");
    // Set by hand rather than relying on two closeGoal calls landing in different milliseconds.
    t.db.run(`update goals set closed_at = '2026-09-01T00:00:00.000Z' where id = ${closedOld.id}`);
    t.db.run(`update goals set closed_at = '2026-09-20T00:00:00.000Z' where id = ${closedNew.id}`);
    const list = goalsWithMeasure(t.db, {}, TODAY);
    expect(list.map((g) => g.title)).toEqual(["ActiveSoon", "ActiveLate", "ClosedNew", "ClosedOld"]);
  });
});
