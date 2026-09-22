import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { eq } from "drizzle-orm";
import { activitySessions, calendarEvents } from "@/db/schema";
import { replaceCalendarEvents, findMeetingFor, isInterview, captureMeeting, labelMeetings, localDay, dayBounds, listMeetings, joinUrlFrom } from "./calendar";
import { ingestHeartbeat } from "./sessions";
import { parseMeta } from "@/domain/items";

const T0 = Date.parse("2026-09-16T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const zoom = (s: number) => ({ at: at(s), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });

describe("calendar", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("computes local days and bounds", () => {
    const day = localDay(at(0));
    const { start, end } = dayBounds(day);
    expect(Date.parse(end) - Date.parse(start)).toBe(86_400_000);
    expect(at(0) >= start && at(0) < end).toBe(true);
    expect(() => dayBounds("2026-9-1")).toThrow(/YYYY-MM-DD/);
  });

  it("replaces events per day and prefers call-link events on overlap", () => {
    const r = replaceCalendarEvents(t.db, [
      { externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: false },
      { externalId: "b", title: "Interview: Jane", startsAt: at(600), endsAt: at(2400), attendees: 2, hasCallLink: true },
    ]);
    expect(r.inserted).toBe(2);
    expect(findMeetingFor(t.db, at(700))?.externalId).toBe("b");
    expect(findMeetingFor(t.db, at(100))?.externalId).toBe("a");
    expect(findMeetingFor(t.db, at(5000))).toBeUndefined();
    expect(findMeetingFor(t.db, at(0))?.externalId).toBe("a");
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync (moved)", startsAt: at(0), endsAt: at(900), attendees: 4, hasCallLink: false }]);
    const rows = t.db.select().from(calendarEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Weekly sync (moved)");
  });

  it("labels meeting sessions on open and retroactively", () => {
    ingestHeartbeat(t.db, zoom(0));
    ingestHeartbeat(t.db, zoom(60));
    expect(t.db.select().from(activitySessions).get()?.meetingId).toBeNull();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: true }]);
    const ev = t.db.select().from(calendarEvents).get()!;
    expect(t.db.select().from(activitySessions).get()?.meetingId).toBe(ev.id);
    ingestHeartbeat(t.db, { at: at(2000), appId: "com.microsoft.VSCode", appName: "Code", title: "x", url: null });
    ingestHeartbeat(t.db, zoom(2100));
    const s = t.db.select().from(activitySessions).all();
    expect(s[2].meetingId).toBeNull();
    expect(labelMeetings(t.db, [localDay(at(0))])).toBe(0);
  });

  it("detects interviews and captures a meeting item once", () => {
    expect(isInterview("Interview: Jane")).toBe(true);
    expect(isInterview("Weekly sync")).toBe(false);
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Interview: Jane", startsAt: at(0), endsAt: at(1800), attendees: 2, hasCallLink: true }]);
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    expect(item.type).toBe("meeting");
    expect(item.title).toBe("Interview: Jane");
    expect(parseMeta<{ calendarEventId: number }>(item).calendarEventId).toBe(ev.id);
    expect(item.body).toContain("2 attendees");
    expect(captureMeeting(t.db, ev.id).id).toBe(item.id);
    expect(() => captureMeeting(t.db, 999)).toThrow(/not found/);
  });

  it("stores the richer fields and derives a join url", () => {
    replaceCalendarEvents(t.db, [
      {
        externalId: "e1",
        title: "Sync",
        startsAt: "2026-09-22T09:00:00.000Z",
        endsAt: "2026-09-22T09:30:00.000Z",
        attendees: 3,
        hasCallLink: true,
        organizer: "Ada",
        attendeeNames: ["Ada", "Bo"],
        location: "Teams",
        joinUrl: null,
        notes: "Join: https://teams.microsoft.com/l/meetup-join/abc",
        allDay: false,
        status: "accepted",
        calendarTitle: "Work",
      },
    ]);
    const [ev] = listMeetings(t.db, { from: "2026-09-22", to: "2026-09-23" });
    expect(ev.organizer).toBe("Ada");
    expect(JSON.parse(ev.attendeeNames)).toEqual(["Ada", "Bo"]);
    expect(ev.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(ev.status).toBe("accepted");
    expect(ev.calendarTitle).toBe("Work");
    expect(ev.allDay).toBe(0);
    expect(ev.noRecord).toBe(0);
    expect(ev.itemId).toBeNull();
  });

  it("lists meetings in a window with a text filter", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "d1", title: "Design review", startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z", attendees: 2, hasCallLink: false, attendeeNames: ["Cy"] },
      { externalId: "d2", title: "Weekly sync", startsAt: "2026-09-24T09:00:00.000Z", endsAt: "2026-09-24T10:00:00.000Z", attendees: 5, hasCallLink: false, organizer: "Bo" },
    ]);
    expect(listMeetings(t.db, { from: "2026-09-20", to: "2026-09-30" }).map((e) => e.title)).toEqual(["Design review", "Weekly sync"]);
    expect(listMeetings(t.db, { from: "2026-09-20", to: "2026-09-30", q: "cy" }).map((e) => e.title)).toEqual(["Design review"]);
    expect(listMeetings(t.db, { from: "2026-09-20", to: "2026-09-30", q: "bo" }).map((e) => e.title)).toEqual(["Weekly sync"]);
    expect(listMeetings(t.db, { from: "2026-09-23", to: "2026-09-30" }).map((e) => e.title)).toEqual(["Weekly sync"]);
  });

  it("joinUrlFrom prefers meeting providers and falls back to any https url", () => {
    expect(joinUrlFrom("room 4", "https://zoom.us/j/1", "see https://example.com")).toBe("https://zoom.us/j/1");
    expect(joinUrlFrom(null, "notes https://example.com/x")).toBe("https://example.com/x");
    expect(joinUrlFrom("nothing")).toBeNull();
  });

  it("keeps the row id, item_id, and no_record when an event is updated", () => {
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: false }]);
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    t.db.update(calendarEvents).set({ noRecord: 1 }).where(eq(calendarEvents.id, ev.id)).run();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync (moved)", startsAt: at(0), endsAt: at(900), attendees: 4, hasCallLink: false }]);
    const rows = t.db.select().from(calendarEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ev.id, title: "Weekly sync (moved)", endsAt: at(900), itemId: item.id, noRecord: 1 });
  });

  it("drops events that vanish from the window and leaves the ones outside it", () => {
    const inside = { externalId: "in", title: "Inside", startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z", attendees: 1, hasCallLink: false };
    const alsoInside = { externalId: "in2", title: "Also inside", startsAt: "2026-09-23T09:00:00.000Z", endsAt: "2026-09-23T10:00:00.000Z", attendees: 1, hasCallLink: false };
    const outside = { externalId: "out", title: "Outside", startsAt: "2026-10-05T09:00:00.000Z", endsAt: "2026-10-05T10:00:00.000Z", attendees: 1, hasCallLink: false };
    const window = { from: "2026-09-20", to: "2026-09-30" };
    replaceCalendarEvents(t.db, [inside, alsoInside], window);
    replaceCalendarEvents(t.db, [outside], { from: "2026-10-01", to: "2026-10-10" });
    const keptId = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "in")).get()!.id;

    const r = replaceCalendarEvents(t.db, [inside], window);
    expect(r.removed).toBe(1);
    const rows = t.db.select().from(calendarEvents).all();
    expect(rows.map((e) => e.externalId).sort()).toEqual(["in", "out"]);
    expect(rows.find((e) => e.externalId === "in")!.id).toBe(keptId);
  });

  it("without a window a payload speaks only for the days it carries", () => {
    const monday = { externalId: "m", title: "Monday", startsAt: "2026-09-21T09:00:00.000Z", endsAt: "2026-09-21T10:00:00.000Z", attendees: 1, hasCallLink: false };
    const tuesday = { externalId: "t1", title: "Tuesday", startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T10:00:00.000Z", attendees: 1, hasCallLink: false };
    const tuesdayToo = { externalId: "t2", title: "Tuesday too", startsAt: "2026-09-22T11:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z", attendees: 1, hasCallLink: false };
    replaceCalendarEvents(t.db, [monday, tuesday, tuesdayToo]);
    replaceCalendarEvents(t.db, [tuesday]);
    expect(t.db.select().from(calendarEvents).all().map((e) => e.externalId).sort()).toEqual(["m", "t1"]);
  });
});
