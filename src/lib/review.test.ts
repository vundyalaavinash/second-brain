import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents } from "@/domain/activity";
import { archiveContainer, createContainer } from "@/domain/containers";
import { finishFocus, startFocus } from "@/domain/focus";
import { createGoal, setGoalLinks } from "@/domain/goals";
import { createItem } from "@/domain/items";
import { addToPlan } from "@/domain/plan";
import { openReview, saveReviewStep } from "@/domain/review";
import { completeTask, createTask, dropTask } from "@/domain/tasks";
import { reviewPayload } from "./review";

const WEEK = "2026-09-21"; // Monday
const NEXT_WEEK = "2026-09-28";
/** Wednesday of the week under test — inside it, for a `current: true` fixture. */
const NOW = new Date(2026, 8, 23, 10, 0, 0);

/** Noon UTC on `day`: the one instant whose local day is `day` everywhere from UTC-12 to
 * UTC+11:59, so a fixture built from it holds regardless of the machine's own timezone. */
function noon(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** A local wall-clock instant on `day`, as the calendar records it. */
function at(day: string, hour: number, minute = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0).toISOString();
}

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
});
afterEach(() => t.cleanup());

function project(name: string, deadline?: string) {
  return createContainer(t.db, { kind: "project", name, deadline });
}

/** Completes a task, then overwrites its timestamps outright: `completeTask` stamps the real
 * clock, and no test here may depend on when the suite actually runs. */
function doneOn(id: number, day: string): void {
  completeTask(t.db, id);
  const ts = noon(day);
  t.db.run(`update tasks set completed_at = '${ts}', updated_at = '${ts}' where id = ${id}`);
}

/** Drops a task, then overwrites `dropped_at` (and `updated_at`, to match) outright. */
function droppedOn(id: number, day: string): void {
  dropTask(t.db, id);
  const ts = noon(day);
  t.db.run(`update tasks set dropped_at = '${ts}', updated_at = '${ts}' where id = ${id}`);
}

/** Bumps `updated_at` alone, the way an unrelated later edit (a title change, say) would — used
 * to prove the review no longer keys `done`/`dropped` off it. */
function touchTask(id: number, day: string): void {
  t.db.run(`update tasks set updated_at = '${noon(day)}' where id = ${id}`);
}

describe("reviewPayload", () => {
  it("assembles the week's figures from the domains that already own them", () => {
    const launch = project("Launch");

    // Planned on two of the week's days, still open: one thing left, not two.
    const leftover = createTask(t.db, { title: "Draft plan", containerId: launch.id });
    addToPlan(t.db, WEEK, leftover.id);
    addToPlan(t.db, "2026-09-22", leftover.id);

    const shipped = createTask(t.db, { title: "Ship the API", containerId: launch.id });
    doneOn(shipped.id, "2026-09-23");
    const abandoned = createTask(t.db, { title: "Old idea" });
    droppedOn(abandoned.id, "2026-09-24");
    // Closed before the week: neither done nor dropped this week.
    const before = createTask(t.db, { title: "Earlier work", containerId: launch.id });
    doneOn(before.id, "2026-09-14");

    createItem(t.db, { type: "note", title: "Loose note" });
    createItem(t.db, { type: "note", title: "Another loose note" });

    replaceCalendarEvents(t.db, [
      { externalId: "m1", title: "Standup", startsAt: at("2026-09-22", 9), endsAt: at("2026-09-22", 9, 30), attendees: 3, hasCallLink: true },
      { externalId: "m2", title: "Declined sync", startsAt: at("2026-09-23", 9), endsAt: at("2026-09-23", 10), attendees: 2, hasCallLink: false, status: "declined" },
      { externalId: "m3", title: "Public holiday", startsAt: at("2026-09-24", 0), endsAt: at("2026-09-24", 23, 59), attendees: 0, hasCallLink: false, allDay: true },
    ]);

    const run = startFocus(t.db, { taskId: shipped.id, minutes: 25 }, new Date(2026, 8, 23, 14, 0, 0));
    finishFocus(t.db, run.id, "completed", new Date(2026, 8, 23, 14, 25, 0));

    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [launch.id]);

    const payload = reviewPayload(t.db, WEEK, NOW);

    expect(payload.week).toBe(WEEK);
    expect(payload.label).toBe("Week of 21 September 2026");
    expect(payload.days).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(payload.current).toBe(true);
    expect(payload.step).toBe("clear");
    expect(payload.answers).toEqual({});
    expect(payload.savedAt).toBeNull();

    expect(payload.clear.inbox).toBe(2);
    expect(payload.clear.leftover.map((p) => p.id)).toEqual([leftover.id]);

    expect(payload.back.done).toBe(1);
    expect(payload.back.dropped).toBe(1);
    expect(payload.back.slipped).toBe(1);
    expect(payload.back.focusMinutes).toBe(25);
    expect(payload.back.focusRuns).toBe(1);
    // The all-day holiday and the declined sync both take none of the week's meeting count.
    expect(payload.back.meetings).toBe(1);
    // Launch: one open (leftover), two done overall (shipped + before) — 2/3 rounds to 67 —
    // but only `shipped` closed inside the reviewed week, so `closed` is 1, not 2.
    expect(payload.back.projects).toEqual([{ container: { id: launch.id, name: "Launch", slug: launch.slug, kind: "project" }, closed: 1, percent: 67 }]);

    // The goal's movement is measured as of "today" (the week is current) — `shipped` closed
    // the same day, `before` nine days earlier, outside the 7-day movement window.
    const goalEntry = payload.goals.find((g) => g.id === goal.id);
    expect(goalEntry).toBeDefined();
    expect(goalEntry!.measure).toMatchObject({ open: 1, done: 2, total: 3, percent: 67, movement: 1, stalled: false });
  });

  it("is empty in every figure for a week with nothing in it", () => {
    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.clear).toEqual({ inbox: 0, leftover: [] });
    expect(payload.back).toEqual({ done: 0, dropped: 0, slipped: 0, focusMinutes: 0, focusRuns: 0, meetings: 0, projects: [], frozen: false });
    expect(payload.goals).toEqual([]);
    expect(payload.ahead.due).toEqual([]);
    expect(payload.ahead.deadlines).toEqual([]);
    expect(payload.ahead.meetings).toEqual([]);
    expect(payload.step).toBe("clear");
    expect(payload.savedAt).toBeNull();
  });

  it("keys done and dropped on their own timestamps, never on a later edit's updated_at", () => {
    const doneEarly = createTask(t.db, { title: "Closed in August" });
    doneOn(doneEarly.id, "2026-08-01");
    touchTask(doneEarly.id, "2026-09-23"); // edited inside the reviewed week, long after it closed

    const droppedThisWeek = createTask(t.db, { title: "Dropped this week" });
    droppedOn(droppedThisWeek.id, "2026-09-22");
    touchTask(droppedThisWeek.id, "2026-11-01"); // edited well after the week

    const payload = reviewPayload(t.db, WEEK, NOW);
    // A task closed in August, merely touched during the reviewed week, is not done this week.
    expect(payload.back.done).toBe(0);
    // A task dropped this week stays counted here even after a later, unrelated edit moves
    // `updated_at` into a different month entirely.
    expect(payload.back.dropped).toBe(1);
  });

  it("counts a task dropped by archiving its project, same as a hand-dropped task", () => {
    const p = project("Sunset");
    const task = createTask(t.db, { title: "Task", containerId: p.id });
    archiveContainer(t.db, p.id);
    // archiveContainer stamps the real clock; pin it inside the reviewed week like every other
    // fixture here does.
    const ts = noon("2026-09-22");
    t.db.run(`update tasks set dropped_at = '${ts}', updated_at = '${ts}' where id = ${task.id}`);
    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.back.dropped).toBe(1);
  });

  it("reads meetings by the same not-declined, not-all-day rule homePayload counts by", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "a", title: "Real meeting", startsAt: at("2026-09-25", 9), endsAt: at("2026-09-25", 10), attendees: 2, hasCallLink: false },
      { externalId: "b", title: "Declined", startsAt: at("2026-09-25", 11), endsAt: at("2026-09-25", 12), attendees: 2, hasCallLink: false, status: "declined" },
      { externalId: "c", title: "All day", startsAt: at("2026-09-25", 0), endsAt: at("2026-09-25", 23, 59), attendees: 0, hasCallLink: false, allDay: true },
    ]);
    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.back.meetings).toBe(1);
  });

  it("looks at the week after: what's due, what's coming due, and what's on the calendar", () => {
    const docs = project("Docs", "2026-09-30");
    const trip = createTask(t.db, { title: "Plan trip", dueDate: "2026-09-29" });
    const dueThisWeek = createTask(t.db, { title: "Due this week instead", dueDate: "2026-09-23" });
    replaceCalendarEvents(t.db, [{ externalId: "n1", title: "Kickoff", startsAt: at("2026-09-29", 9), endsAt: at("2026-09-29", 10), attendees: 2, hasCallLink: false }]);

    const payload = reviewPayload(t.db, WEEK, NOW);

    expect(payload.ahead.week).toBe(NEXT_WEEK);
    expect(payload.ahead.due.map((task) => task.id)).toEqual([trip.id]);
    expect(payload.ahead.due.map((task) => task.id)).not.toContain(dueThisWeek.id);
    expect(payload.ahead.deadlines).toEqual([{ container: { id: docs.id, name: "Docs", slug: docs.slug, kind: "project" }, deadline: "2026-09-30" }]);
    expect(payload.ahead.meetings.map((m) => m.title)).toEqual(["Kickoff"]);
  });

  it("resumes at the step after the last one saved, and reports when it was last saved", () => {
    openReview(t.db, WEEK);
    saveReviewStep(t.db, WEEK, "clear", "Inbox is empty.");

    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.step).toBe("back");
    expect(payload.answers.clear).toBe("Inbox is empty.");
    expect(payload.savedAt).not.toBeNull();
  });

  it("reports savedAt as null for a review that has been opened but never saved", () => {
    openReview(t.db, WEEK);
    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.step).toBe("clear");
    expect(payload.savedAt).toBeNull();
  });

  it("is only current for the week `now` actually falls in", () => {
    const elsewhere = reviewPayload(t.db, WEEK, new Date(2026, 9, 5, 9, 0, 0));
    expect(elsewhere.current).toBe(false);
  });

  it("measures a past week's goals as of the week's own last day, not as of now", () => {
    const PAST_WEEK = "2026-08-03"; // a Monday, well before WEEK
    const proj = project("Launch");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [proj.id]);
    const task = createTask(t.db, { title: "Ship", containerId: proj.id });
    // Four days before the week's own Sunday (2026-08-09) — inside the movement window measured
    // from the week's last day, but nearly three months before `FAR_LATER`.
    doneOn(task.id, "2026-08-05");

    const FAR_LATER = new Date(2026, 9, 20, 9, 0, 0);
    const payload = reviewPayload(t.db, PAST_WEEK, FAR_LATER);
    const measure = payload.goals.find((g) => g.id === goal.id)!.measure;
    expect(measure.movement).toBe(1);
    expect(measure.stalled).toBe(false);
  });

  it("measures the current week's goals as of today, not its not-yet-reached last day", () => {
    const proj = project("Launch");
    const goal = createGoal(t.db, { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" });
    setGoalLinks(t.db, goal.id, [proj.id]);
    const task = createTask(t.db, { title: "Ship", containerId: proj.id });
    // Two days before the week starts: 3 days before "today" (within the movement window), but
    // 8 days before the week's own (not-yet-reached) last day — outside it.
    doneOn(task.id, "2026-09-19");

    const NOW_MIDWEEK = new Date(2026, 8, 22, 9, 0, 0); // Tuesday of WEEK
    const payload = reviewPayload(t.db, WEEK, NOW_MIDWEEK);
    const measure = payload.goals.find((g) => g.id === goal.id)!.measure;
    expect(measure.movement).toBe(1);
  });

  it("renders a past week's frozen snapshot rather than a live re-query once the underlying tasks have moved on", () => {
    const PAST_WEEK = "2026-08-03"; // a Monday, well before WEEK
    const proj = project("Launch");
    const task = createTask(t.db, { title: "Still open", containerId: proj.id });
    addToPlan(t.db, PAST_WEEK, task.id);

    // Save against the past week while the task is still open: the snapshot freezes slipped: 1.
    const before = reviewPayload(t.db, PAST_WEEK, new Date(2026, 7, 5, 9, 0, 0));
    expect(before.back.slipped).toBe(1);
    expect(before.back.frozen).toBe(false); // nothing saved yet — still a live read
    const snapshot = { done: before.back.done, dropped: before.back.dropped, slipped: before.back.slipped, focusMinutes: before.back.focusMinutes, focusRuns: before.back.focusRuns, meetings: before.back.meetings, projects: before.back.projects.map((p) => ({ containerId: p.container.id, name: p.container.name, closed: p.closed, percent: p.percent })) };
    saveReviewStep(t.db, PAST_WEEK, "back", "Still one thing open.", snapshot);

    // The task closes later — a live query would now say `slipped: 0`.
    completeTask(t.db, task.id);

    const payload = reviewPayload(t.db, PAST_WEEK, NOW);
    expect(payload.back.frozen).toBe(true);
    expect(payload.back.slipped).toBe(1);
    expect(payload.back.done).toBe(0);
  });

  it("never freezes the current week's own figures, even once it has a snapshot", () => {
    openReview(t.db, WEEK);
    saveReviewStep(t.db, WEEK, "back", "Nothing to report.", { done: 9, dropped: 9, slipped: 9, focusMinutes: 9, focusRuns: 9, meetings: 9, projects: [] });
    const payload = reviewPayload(t.db, WEEK, NOW);
    expect(payload.current).toBe(true);
    expect(payload.back.frozen).toBe(false);
    expect(payload.back.done).toBe(0);
  });
});
