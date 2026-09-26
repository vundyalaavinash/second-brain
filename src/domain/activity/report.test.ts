import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { getDay, getWeek, addDays, activityBetween } from "./report";
import { ingestHeartbeat } from "./sessions";
import { replaceCalendarEvents, captureMeeting, dayBounds } from "./calendar";
import { listCategories } from "./rules";
import { calendarEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setMeetingDecision } from "@/domain/meetings/decision";
import { localDay } from "@/lib/time";

describe("activity reports", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("totals a day by category, app, and site, clipped to the day", () => {
    const day = "2026-09-16";
    const { start, end } = dayBounds(day);
    const S = Date.parse(start);
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    ingestHeartbeat(t.db, { at: at(3600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 605), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 905), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 910), afk: true });
    ingestHeartbeat(t.db, { at: at(3600 + 1000), afk: true });
    const E = Date.parse(end);
    ingestHeartbeat(t.db, { at: new Date(E - 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });
    ingestHeartbeat(t.db, { at: new Date(E + 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });

    const d = getDay(t.db, day);
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    // Code 600s, Chrome 300s, afk 90s (excluded from active), Notes 60s inside the day; the two 5s hand-offs count too.
    expect(d.activeMs).toBe(600_000 + 5_000 + 300_000 + 5_000 + 60_000);
    const coding = d.byCategory.find((c) => c.categoryId === cats.Coding)!;
    expect(coding.ms).toBe(600_000 + 5_000 + 300_000 + 5_000);
    expect(d.byApp[0]).toMatchObject({ appId: "com.microsoft.VSCode" });
    expect(d.bySite.find((s) => s.key === "github.com")?.ms).toBe(305_000);
    expect(d.sessions.some((s) => s.afk)).toBe(true);
    expect(d.sessions.every((s) => s.startedAt >= start && s.endedAt <= end)).toBe(true);
  });

  it("reports meetings with scheduled versus actual minutes and capture state", () => {
    const day = "2026-09-16";
    const S = Date.parse(dayBounds(day).start) + 10 * 3600_000;
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Interview: Jane", startsAt: at(0), endsAt: at(1800), attendees: 2, hasCallLink: true }]);
    // Heartbeats 600s apart: within GAP_MS (15min) so they fold into one session (600s span, not a split at each hb).
    ingestHeartbeat(t.db, { at: at(60), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    ingestHeartbeat(t.db, { at: at(660), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    let d = getDay(t.db, day);
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0]).toMatchObject({ title: "Interview: Jane", interview: true, scheduledMs: 1800_000, actualMs: 600_000, itemId: null });
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    d = getDay(t.db, day);
    expect(d.meetings[0].itemId).toBe(item.id);
  });

  it("builds a week of daily category totals", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    const S = Date.parse(dayBounds("2026-09-14").start) + 9 * 3600_000;
    ingestHeartbeat(t.db, { at: new Date(S).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: new Date(S + 120_000).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const w = getWeek(t.db, "2026-09-14");
    expect(w.days).toHaveLength(7);
    expect(w.days[0].day).toBe("2026-09-14");
    expect(w.days[0].activeMs).toBe(120_000);
    expect(w.days[6].day).toBe("2026-09-20");
    expect(w.days[6].activeMs).toBe(0);
  });
});

describe("activityBetween", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  const T0 = Date.parse("2026-09-16T09:00:00.000Z");
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();

  it("returns sessions overlapping an arbitrary instant range, not bounded to one local day", () => {
    // A meeting sitting entirely inside a day, nowhere near either midnight boundary.
    ingestHeartbeat(t.db, { at: at(0), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const sessions = activityBetween(t.db, at(-60), at(1200));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].appId).toBe("com.microsoft.VSCode");
  });

  it("clips a session that starts before the range to the range's own start", () => {
    ingestHeartbeat(t.db, { at: at(-300), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(300), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const sessions = activityBetween(t.db, at(0), at(600));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].startedAt).toBe(at(0));
    expect(sessions[0].endedAt).toBe(at(300));
  });

  it("clips a session that ends after the range to the range's own end", () => {
    // A meeting's window must not have its minutes attributed outside the meeting: a session
    // that runs on past the meeting's end is clipped there, not counted a second past it.
    ingestHeartbeat(t.db, { at: at(300), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(900), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const sessions = activityBetween(t.db, at(0), at(600));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].startedAt).toBe(at(300));
    expect(sessions[0].endedAt).toBe(at(600));
  });
});

// F-B (final whole-branch review): `getDay` resolved a meeting's decision with plain
// `effectiveDecision`, which reads `meetingSeriesDecisions` as unconditionally current. `getDay`
// serves *any* day, so declining a long-running series today re-rendered every occurrence from
// months ago as "Not going" -- directly contradicting the meeting audit, which reads the same rows
// through `effectiveDecisionAsOf` and correctly still reports the old attendance.
describe("getDay resolves a series decision as of the occurrence, not as of now", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  // `setMeetingDecision` stamps `decidedAt` from the real wall clock, not an injectable one, so
  // these cases are anchored to real `Date.now()`: one occurrence genuinely behind it, one
  // genuinely ahead of it. Both belong to the same series and neither carries an override.
  const DAY_MS = 86_400_000;
  const past = new Date(Date.now() - 10 * DAY_MS);
  const future = new Date(Date.now() + 10 * DAY_MS);
  const halfHourAfter = (d: Date) => new Date(d.getTime() + 30 * 60_000).toISOString();

  // `untouched-occ` is a second occurrence on the same day and series that the series write below
  // is never issued from -- the actual case F-B's `decidedAt` scoping protects. `past-occ`, the
  // occurrence someone would genuinely be looking at when choosing "every time", is issued from
  // directly, so `setMeetingDecision` writes its own matching override rather than clearing it
  // (second final whole-branch review, priority 2/6) -- clearing would make the click resolve back
  // to "going" for the very row that prompted it, which was the actual bug.
  function declineTheSeries(t: TestDb) {
    replaceCalendarEvents(t.db, [
      { externalId: "past-occ", title: "Weekly sync", startsAt: past.toISOString(), endsAt: halfHourAfter(past), attendees: 3, hasCallLink: true, seriesId: "eventkit:weekly" },
      { externalId: "untouched-occ", title: "Weekly sync", startsAt: halfHourAfter(past), endsAt: halfHourAfter(new Date(past.getTime() + 30 * 60_000)), attendees: 3, hasCallLink: true, seriesId: "eventkit:weekly" },
      { externalId: "future-occ", title: "Weekly sync", startsAt: future.toISOString(), endsAt: halfHourAfter(future), attendees: 3, hasCallLink: true, seriesId: "eventkit:weekly" },
    ]);
    const issuedFrom = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "past-occ")).get()!;
    setMeetingDecision(t.db, issuedFrom.id, { decision: "not-going", scope: "series" });
  }

  it("writes the decision straight onto the past occurrence someone actually declined from", () => {
    declineTheSeries(t);
    const meeting = getDay(t.db, localDay(past.toISOString())).meetings.find((m) => m.startsAt === past.toISOString())!;
    expect(meeting.decision).toBe("not-going");
    expect(meeting.seriesDecision).toBe("not-going");
  });

  it("leaves an untouched past day's meeting showing the decision that was actually in force when it happened", () => {
    declineTheSeries(t);
    const meeting = getDay(t.db, localDay(past.toISOString())).meetings.find((m) => m.startsAt === halfHourAfter(past))!;
    // The hour was genuinely sat through, under no decision at all -- the default. Before the fix
    // this read "not-going", dimming and hiding an hour that already happened.
    expect(meeting.decision).toBe("going");
    // The standing series decision is still reported as such: the row needs to know one exists at
    // all (that is what makes it reversible), it just does not govern this occurrence.
    expect(meeting.seriesDecision).toBe("not-going");
  });

  it("applies the same decline immediately to an occurrence still ahead", () => {
    declineTheSeries(t);
    const [meeting] = getDay(t.db, localDay(future.toISOString())).meetings;
    expect(meeting.decision).toBe("not-going");
    expect(meeting.seriesDecision).toBe("not-going");
  });
});
