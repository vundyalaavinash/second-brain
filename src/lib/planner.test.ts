import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { captureMeeting, listMeetings, replaceCalendarEvents } from "@/domain/activity";
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
    expect(day.due.overdue.map((x) => x.id)).toEqual([late.id]);
    expect(day.due.today.map((x) => x.id)).toEqual([due.id]);

    // The week ends on the 27th, so October's task is never loaded into a column.
    const week = plannerWeek(t.db, "2026-09-21");
    expect(week.days.flatMap((d) => d.due.map((x) => x.title))).toEqual(["Due"]);
  });
});
