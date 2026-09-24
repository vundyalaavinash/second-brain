import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { captureMeeting, listMeetings, replaceCalendarEvents } from "@/domain/activity";
import { createContainer } from "@/domain/containers";
import { addBlock } from "@/domain/blocks";
import { addToPlan } from "@/domain/plan";
import { createTask } from "@/domain/tasks";
import { hasUserNotes, plannerDay, plannerWeek } from "./planner";

/** What `captureMeeting` writes into a fresh meeting item. */
const TEMPLATE = [
  "**When:** 2026-09-22 10:30 to 11:00",
  "**Who:** 4 attendees",
  "",
  "## Notes",
  "",
  "## Actions",
  "",
  "- [ ] ",
].join("\n");

describe("hasUserNotes", () => {
  it("does not count the pristine capture template", () => {
    expect(hasUserNotes(TEMPLATE)).toBe(false);
  });

  it("counts text written under Notes", () => {
    expect(hasUserNotes(TEMPLATE.replace("## Notes\n", "## Notes\nAgreed to ship on Friday\n"))).toBe(true);
  });

  it("counts an action that has been filled in", () => {
    expect(hasUserNotes(TEMPLATE.replace("- [ ] ", "- [ ] Email Ada the deck"))).toBe(true);
  });

  it("counts a note that is not the template at all", () => {
    expect(hasUserNotes("Dropped-in recording")).toBe(true);
    expect(hasUserNotes("   ")).toBe(false);
  });

  it("does not count text before Actions when there is no Notes heading", () => {
    const body = ["Some preamble with real content", "", "## Actions", "", "- [ ] "].join("\n");
    expect(hasUserNotes(body)).toBe(false);
  });
});

describe("plannerDay", () => {
  let t: TestDb;
  const DATE = "2026-09-22";
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  function meeting() {
    replaceCalendarEvents(t.db, [
      { externalId: "a", title: "Product sync", startsAt: `${DATE}T10:00:00.000Z`, endsAt: `${DATE}T11:00:00.000Z`, attendees: 3, hasCallLink: true },
    ]);
    return listMeetings(t.db, { from: DATE, to: "2026-09-23" })[0];
  }

  it("carries each captured meeting's badges, the way the meetings list does", () => {
    const ev = meeting();
    expect(plannerDay(t.db, DATE).meetings[0].item).toBeUndefined();
    const item = captureMeeting(t.db, ev.id);
    expect(plannerDay(t.db, DATE).meetings[0].item).toEqual({ id: item.id, hasNotes: false, hasTranscript: false, hasSummary: false });
  });

  it("loads only the tasks the day and the week can show", () => {
    const late = createTask(t.db, { title: "Late", dueDate: "2026-09-20" });
    const due = createTask(t.db, { title: "Due", dueDate: DATE });
    createTask(t.db, { title: "Next month", dueDate: "2026-10-20" });
    createTask(t.db, { title: "Someday" });

    const day = plannerDay(t.db, DATE);
    expect(day.sources.due.overdue.map((x) => x.id)).toEqual([late.id]);
    expect(day.sources.due.today.map((x) => x.id)).toEqual([due.id]);

    // The week ends on the 27th, so October's task is never loaded into a column.
    const week = plannerWeek(t.db, "2026-09-21");
    expect(week.days.flatMap((d) => d.due.map((x) => x.title))).toEqual(["Due"]);
  });

  it("carries the day's own sessions and leaves the rest of a task's out of the payload", () => {
    const task = createTask(t.db, { title: "Runs for days", estimateMinutes: 90 });
    addToPlan(t.db, DATE, task.id);
    addToPlan(t.db, "2026-09-23", task.id);
    addBlock(t.db, { taskId: task.id, startsAt: `${DATE}T10:00:00`, minutes: 45 });
    addBlock(t.db, { taskId: task.id, startsAt: "2026-09-23T10:00:00", minutes: 45 });
    const day = plannerDay(t.db, DATE);
    // The column draws one day, so the payload carries one day: tomorrow's session is not here.
    expect(day.plan[0].blocks.map((b) => b.startsAt)).toEqual([`${DATE}T10:00:00`]);
    expect(day.sources.inbox.find((x) => x.id === task.id)!.blocks.map((b) => b.startsAt)).toEqual([`${DATE}T10:00:00`]);
    // A week column may hold either of them, so the week payload carries both days'.
    const week = plannerWeek(t.db, "2026-09-21");
    expect(week.days[1].capacity.blockedMinutes).toBe(45);
    expect(week.days[2].capacity.blockedMinutes).toBe(45);
  });

  it("groups every open task by where it lives and marks the day's capacity", () => {
    const project = createContainer(t.db, { kind: "project", name: "Launch" });
    const area = createContainer(t.db, { kind: "area", name: "Health" });
    const empty = createContainer(t.db, { kind: "project", name: "Idle" });
    const inbox = createTask(t.db, { title: "Loose", estimateMinutes: 25 });
    const late = createTask(t.db, { title: "Late", dueDate: "2026-09-20", containerId: project.id });
    const todayTask = createTask(t.db, { title: "Today", dueDate: "2026-09-23", containerId: area.id, estimateMinutes: 45 });
    const planned = createTask(t.db, { title: "Planned", containerId: project.id, estimateMinutes: 60 });
    addBlock(t.db, { taskId: planned.id, startsAt: "2026-09-23T10:00:00", minutes: 60 });
    addToPlan(t.db, "2026-09-23", planned.id);
    addToPlan(t.db, "2026-09-23", todayTask.id);
    replaceCalendarEvents(t.db, [
      { externalId: "m1", title: "Sync", startsAt: "2026-09-23T10:00:00", endsAt: "2026-09-23T11:00:00", attendees: 2, hasCallLink: true },
    ]);
    const day = plannerDay(t.db, "2026-09-23");
    expect(day.sources.inbox.map((x) => x.id)).toEqual([inbox.id]);
    expect(day.sources.due.overdue.map((x) => x.id)).toEqual([late.id]);
    expect(day.sources.due.today).toEqual([]); // already planned
    expect(day.sources.projects.map((g) => [g.container.name, g.tasks.length])).toEqual([["Launch", 2], ["Idle", 0]]);
    // A group carries the name its heading needs and nothing more: no counts, no progress.
    expect(day.sources.projects[0].container).toEqual({ id: project.id, name: "Launch", slug: project.slug, kind: "project" });
    expect(day.sources.areas.map((g) => [g.container.name, g.tasks.map((x) => x.id)])).toEqual([["Health", [todayTask.id]]]);
    // The 45-minute task on the plan has no session yet, so it is the whole unplaced figure.
    expect(day.capacity).toEqual({ freeMinutes: 480, plannedMinutes: 105, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 60, unplacedMinutes: 45 });
    void empty;
    const week = plannerWeek(t.db, "2026-09-21");
    expect(week.days[2].capacity).toEqual({ freeMinutes: 480, plannedMinutes: 105, blockedMinutes: 60 });
    expect(week.days[0].capacity).toEqual({ freeMinutes: 540, plannedMinutes: 0, blockedMinutes: 0 });
  });
});
