import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { focusRuns } from "@/db/schema";
import { createTask } from "@/domain/tasks";
import {
  startFocus,
  finishFocus,
  runningFocus,
  focusMinutesByTask,
  focusSummary,
  completedToday,
  getFocusSettings,
  ABANDON_UNDER,
  STALE_AFTER,
} from "./index";

const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
});
afterEach(() => t.cleanup());

describe("a focus run", () => {
  it("books its minutes against the task when the clock runs out", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    const run = startFocus(t.db, { taskId: task.id, minutes: 45 }, at("09:00"));
    const done = finishFocus(t.db, run.id, "completed", at("09:45"));
    expect(done).toMatchObject({ outcome: "completed", actualMinutes: 45 });
    expect(focusMinutesByTask(t.db, [task.id]).get(task.id)).toBe(45);
  });

  it("keeps the minutes actually run when it is stopped early", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    const run = startFocus(t.db, { taskId: task.id, minutes: 45 }, at("09:00"));
    expect(finishFocus(t.db, run.id, "stopped", at("09:20"))).toMatchObject({ outcome: "stopped", actualMinutes: 20 });
  });

  it("abandons a run ended inside the first two minutes, whatever it is called, and books nothing", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    const run = startFocus(t.db, { taskId: task.id, minutes: 45 }, at("09:00"));
    const done = finishFocus(t.db, run.id, "stopped", at("09:01"));
    expect(done).toMatchObject({ outcome: "abandoned", actualMinutes: 0 });
    expect(focusMinutesByTask(t.db, [task.id]).get(task.id) ?? 0).toBe(0);
    expect(ABANDON_UNDER).toBe(2);
  });

  it("starting a second run stops the first", () => {
    const a = createTask(t.db, { title: "A" });
    const b = createTask(t.db, { title: "B" });
    const first = startFocus(t.db, { taskId: a.id, minutes: 45 }, at("09:00"));
    startFocus(t.db, { taskId: b.id, minutes: 25 }, at("09:30"));
    const rows = t.db.select().from(focusRuns).all();
    const stopped = rows.find((r) => r.id === first.id)!;
    expect(stopped).toMatchObject({ outcome: "stopped", actualMinutes: 30 });
    expect(runningFocus(t.db, at("09:35"))!.taskId).toBe(b.id);
  });

  it("is still live inside the grace period, and closed at its planned end past it", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    startFocus(t.db, { taskId: task.id, minutes: 45 }, at("09:00"));
    expect(runningFocus(t.db, at("10:00"))).not.toBeNull(); // 15 min past, inside STALE_AFTER
    const gone = runningFocus(t.db, at("11:00")); // 75 min past, beyond it
    expect(gone).toBeNull();
    expect(focusMinutesByTask(t.db, [task.id]).get(task.id)).toBe(45); // closed at the end it was meant to have
    expect(STALE_AFTER).toBe(30);
  });

  it("refuses a run on a task that is not there", () => {
    expect(() => startFocus(t.db, { taskId: 9999, minutes: 25 }, at("09:00"))).toThrow(/task/i);
  });

  it("refuses a run outside 5 to 480 minutes", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    expect(() => startFocus(t.db, { taskId: task.id, minutes: 4 }, at("09:00"))).toThrow();
    expect(() => startFocus(t.db, { taskId: task.id, minutes: 481 }, at("09:00"))).toThrow();
  });

  it("uses the configured default length when none is given", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    expect(getFocusSettings(t.db).defaultMinutes).toBe(25);
    const run = startFocus(t.db, { taskId: task.id }, at("09:00"));
    expect(run.plannedMinutes).toBe(25);
  });

  it("survives its task being deleted underneath it", () => {
    const task = createTask(t.db, { title: "Draft the brief" });
    const run = startFocus(t.db, { taskId: task.id, minutes: 45 }, at("09:00"));
    finishFocus(t.db, run.id, "completed", at("09:45"));
    t.db.run(`delete from tasks where id = ${task.id}`);
    expect(() => focusSummary(t.db, { from: "2026-09-24", to: "2026-09-25" })).not.toThrow();
  });

  it("sums a range by task, counting only the runs that booked minutes", () => {
    const a = createTask(t.db, { title: "A" });
    finishFocus(t.db, startFocus(t.db, { taskId: a.id, minutes: 25 }, at("09:00")).id, "completed", at("09:25"));
    finishFocus(t.db, startFocus(t.db, { taskId: a.id, minutes: 25 }, at("10:00")).id, "stopped", at("10:01"));
    const s = focusSummary(t.db, { from: "2026-09-24", to: "2026-09-25" });
    expect(s).toMatchObject({ minutes: 25, runs: 1 });
    expect(s.byTask).toEqual([{ taskId: a.id, title: "A", minutes: 25, runs: 1 }]);
    expect(completedToday(t.db, "2026-09-24")).toBe(1);
  });
});
