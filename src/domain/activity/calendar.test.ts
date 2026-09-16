import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { activitySessions, calendarEvents } from "@/db/schema";
import { replaceCalendarEvents, findMeetingFor, isInterview, captureMeeting, labelMeetings, localDay, dayBounds } from "./calendar";
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
});
