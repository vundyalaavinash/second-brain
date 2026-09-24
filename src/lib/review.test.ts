import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents } from "@/domain/activity";
import { createContainer } from "@/domain/containers";
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

/** Drops a task, then overwrites `updated_at` outright — the only timestamp a drop leaves. */
function droppedOn(id: number, day: string): void {
  dropTask(t.db, id);
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
    expect(payload.label).toMatch(/21 September/);
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
    expect(payload.back.projects).toEqual([{ container: { id: launch.id, name: "Launch", slug: launch.slug, kind: "project" }, closed: 1, percent: expect.any(Number) }]);

    expect(payload.goals.map((g) => g.id)).toContain(goal.id);
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

  it("is only current for the week `now` actually falls in", () => {
    const elsewhere = reviewPayload(t.db, WEEK, new Date(2026, 9, 5, 9, 0, 0));
    expect(elsewhere.current).toBe(false);
  });
});
