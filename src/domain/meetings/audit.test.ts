import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents, captureMeeting } from "@/domain/activity/calendar";
import { ingestHeartbeat } from "@/domain/activity/sessions";
import { dayBounds, localDay } from "@/domain/activity";
import { calendarEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTask } from "@/domain/tasks";
import { updateItem } from "@/domain/items";
import { setMeetingDecision } from "./decision";
import { auditSeries, nextOccurrenceIds, weeklyMeetingShare } from "./audit";

// Anchored to a local day's own midnight (`dayBounds`), not a bare UTC literal: `auditSeries`
// reads its window through the `day` column, which is computed from local wall-clock time, so a
// test built from raw `...Z` timestamps would silently drift a day off itself under a timezone
// east of Greenwich or west of it -- exactly the class of bug `TZ=Pacific/Midway npm test` exists
// to catch across this whole slice.
const DAY = "2026-09-01";
const T0 = Date.parse(dayBounds(DAY).start) + 9 * 3600_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const SINCE = localDay(at(0));
const NOW = new Date(T0 + 120 * 86_400_000);

function eventBy(t: TestDb, externalId: string) {
  return t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, externalId)).get()!;
}

describe("auditSeries", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("groups occurrences by seriesId across the whole window", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "s1", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 3, hasCallLink: true, seriesId: "eventkit:weekly" },
      {
        externalId: "s2",
        title: "Weekly sync",
        startsAt: at(7 * 86400),
        endsAt: at(7 * 86400 + 1800),
        attendees: 3,
        hasCallLink: true,
        seriesId: "eventkit:weekly",
      },
      { externalId: "o1", title: "One-off catchup", startsAt: at(3600), endsAt: at(3600 + 900), attendees: 2, hasCallLink: false },
    ]);
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    const weekly = audits.find((a) => a.seriesId === "eventkit:weekly")!;
    expect(weekly.occurrences).toBe(2);
    const oneOff = audits.find((a) => a.title === "One-off catchup")!;
    expect(oneOff.seriesId).toBeNull();
    expect(oneOff.occurrences).toBe(1);
  });

  it("computes attendance as the share whose effective decision was going or maybe", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "a1", title: "Standup", startsAt: at(0), endsAt: at(900), attendees: 4, hasCallLink: true, seriesId: "eventkit:standup" },
      {
        externalId: "a2",
        title: "Standup",
        startsAt: at(86400),
        endsAt: at(86400 + 900),
        attendees: 4,
        hasCallLink: true,
        seriesId: "eventkit:standup",
      },
      {
        externalId: "a3",
        title: "Standup",
        startsAt: at(2 * 86400),
        endsAt: at(2 * 86400 + 900),
        attendees: 4,
        hasCallLink: true,
        seriesId: "eventkit:standup",
      },
    ]);
    setMeetingDecision(t.db, eventBy(t, "a2").id, { decision: "not-going", scope: "occurrence" });
    setMeetingDecision(t.db, eventBy(t, "a3").id, { decision: "maybe", scope: "occurrence" });
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    const standup = audits.find((a) => a.seriesId === "eventkit:standup")!;
    expect(standup.occurrences).toBe(3);
    // a1 defaults to going, a2 is not-going, a3 is maybe: two of three attended.
    expect(standup.attendedCount).toBe(2);
  });

  it("orders by total minutes, the recurring cost first, not the rare long workshop", () => {
    // Twenty 15-minute standups (300 minutes total) against one 3-hour workshop (180 minutes),
    // on days that never collide with each other so a sync upsert never purges one for the other.
    const standups = Array.from({ length: 20 }, (_, i) => ({
      externalId: `standup-${i}`,
      title: "Standup",
      startsAt: at(i * 86400),
      endsAt: at(i * 86400 + 900),
      attendees: 4,
      hasCallLink: true,
      seriesId: "eventkit:standup",
    }));
    const workshop = { externalId: "workshop", title: "Strategy workshop", startsAt: at(30 * 86400), endsAt: at(30 * 86400 + 10800), attendees: 8, hasCallLink: true };
    replaceCalendarEvents(t.db, [...standups, workshop]);
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    expect(audits[0].seriesId).toBe("eventkit:standup");
    expect(audits[0].totalMinutes).toBe(20 * 15);
    const workshopAudit = audits.find((a) => a.title === "Strategy workshop")!;
    expect(workshopAudit.totalMinutes).toBe(180);
    expect(audits[0].totalMinutes).toBeGreaterThan(workshopAudit.totalMinutes);
  });

  it("groups many series correctly at scale -- the grouping this repo's batching rule protects, not one query per series", () => {
    // Structurally, `auditSeries` reads the window's events, decisions, captured items, and
    // tasks each in one grouped query regardless of how many series are in play (see its own doc
    // comment) -- this exercises that at a scale (12 series, 4 occurrences each) where a
    // one-query-per-series implementation would visibly slow down, and checks the grouping itself
    // stays correct at that scale.
    const series = Array.from({ length: 12 }, (_, s) =>
      Array.from({ length: 4 }, (_, i) => ({
        externalId: `s${s}-${i}`,
        title: `Series ${s}`,
        startsAt: at((s * 4 + i) * 3600),
        endsAt: at((s * 4 + i) * 3600 + 1500),
        attendees: 3,
        hasCallLink: true,
        seriesId: `eventkit:series-${s}`,
      })),
    ).flat();
    replaceCalendarEvents(t.db, series);
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    expect(audits).toHaveLength(12);
    expect(audits.every((a) => a.occurrences === 4)).toBe(true);
  });

  it("names what activity ran during the series' occurrences, using activityBetween per occurrence's own window, merged", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "b1", title: "Design review", startsAt: at(0), endsAt: at(1800), attendees: 3, hasCallLink: true, seriesId: "eventkit:design" },
      {
        externalId: "b2",
        title: "Design review",
        startsAt: at(86400),
        endsAt: at(86400 + 1800),
        attendees: 3,
        hasCallLink: true,
        seriesId: "eventkit:design",
      },
    ]);
    // In the editor for the first ten minutes of the first occurrence...
    ingestHeartbeat(t.db, { at: at(0), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    // ...and in the browser for the first five minutes of the second, a day later.
    ingestHeartbeat(t.db, { at: at(86400), appId: "com.google.Chrome", appName: "Chrome", title: "x", url: "https://example.com" });
    ingestHeartbeat(t.db, { at: at(86400 + 300), appId: "com.google.Chrome", appName: "Chrome", title: "x", url: "https://example.com" });
    // Well outside either occurrence: must not be attributed to this series at all.
    ingestHeartbeat(t.db, { at: at(50000), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });
    ingestHeartbeat(t.db, { at: at(50600), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });

    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    const design = audits.find((a) => a.seriesId === "eventkit:design")!;
    const labels = design.topActivity.map((a) => a.label);
    expect(labels).toContain("Code");
    expect(labels).not.toContain("Notes");
    expect(labels.some((l) => l === "Chrome" || l === "example.com")).toBe(true);
  });

  it("names what a captured meeting item actually holds -- notes, transcript, and tasks made from it", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "c1", title: "Platform sync", startsAt: at(0), endsAt: at(1800), attendees: 5, hasCallLink: true, seriesId: "eventkit:platform" },
      {
        externalId: "c2",
        title: "Platform sync",
        startsAt: at(86400),
        endsAt: at(86400 + 1800),
        attendees: 5,
        hasCallLink: true,
        seriesId: "eventkit:platform",
      },
    ]);
    const ev1 = eventBy(t, "c1");
    const item1 = captureMeeting(t.db, ev1.id);
    updateItem(t.db, item1.id, { body: "## Notes\n\nDecided the rollout plan.\n\n## Actions\n\n- [ ] " });
    createTask(t.db, { title: "Ship the rollout plan", sourceItemId: item1.id });

    const ev2 = eventBy(t, "c2");
    const item2 = captureMeeting(t.db, ev2.id);
    updateItem(t.db, item2.id, { meta: { transcript: "...said things..." } });

    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    const platform = audits.find((a) => a.seriesId === "eventkit:platform")!;
    expect(platform.lastNoteAt).toBe(ev1.startsAt);
    expect(platform.hasTranscript).toBe(true);
    expect(platform.tasksSince).toBe(1);
  });

  it("groups a null seriesId as its own singleton rather than one shared bucket", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "n1", title: "Ad hoc chat", startsAt: at(0), endsAt: at(900), attendees: 2, hasCallLink: false },
      { externalId: "n2", title: "Another ad hoc chat", startsAt: at(3600), endsAt: at(4500), attendees: 2, hasCallLink: false },
    ]);
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    expect(audits.filter((a) => a.seriesId === null)).toHaveLength(2);
    expect(audits.every((a) => a.occurrences === 1)).toBe(true);
  });

  it("drops an occurrence that has not started yet -- not evidence of anything that happened", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "f1", title: "Future thing", startsAt: new Date(NOW.getTime() + 3600_000).toISOString(), endsAt: new Date(NOW.getTime() + 7200_000).toISOString(), attendees: 2, hasCallLink: true },
    ]);
    const audits = auditSeries(t.db, { since: SINCE, now: NOW });
    expect(audits).toHaveLength(0);
  });
});

describe("weeklyMeetingShare", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("halves a maybe and drops a not-going meeting, against the working week", () => {
    const week = "2026-09-14"; // a Monday, checked purely by its digits so it's a Monday under any TZ
    const S = Date.parse(dayBounds(week).start) + 10 * 3600_000;
    const wat = (s: number) => new Date(S + s * 1000).toISOString();
    replaceCalendarEvents(t.db, [
      { externalId: "w1", title: "Going", startsAt: wat(0), endsAt: wat(3600), attendees: 2, hasCallLink: true },
      { externalId: "w2", title: "Maybe", startsAt: wat(90000), endsAt: wat(90000 + 3600), attendees: 2, hasCallLink: true },
      { externalId: "w3", title: "Skipped", startsAt: wat(180000), endsAt: wat(180000 + 3600), attendees: 2, hasCallLink: true },
    ]);
    setMeetingDecision(t.db, eventBy(t, "w2").id, { decision: "maybe", scope: "occurrence" });
    setMeetingDecision(t.db, eventBy(t, "w3").id, { decision: "not-going", scope: "occurrence" });

    const share = weeklyMeetingShare(t.db, week);
    expect(share.minutes).toBe(60 + 30); // full hour + half an hour, nothing for the declined one
    // Default work hours 09:00-18:00 (9h/day) times the default five working days.
    expect(share.workingMinutes).toBe(9 * 60 * 5);
  });
});

describe("nextOccurrenceIds", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("finds the soonest occurrence still ahead of now, one query for the whole list", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "p1", title: "Past", startsAt: at(-7200), endsAt: at(-5400), attendees: 2, hasCallLink: true, seriesId: "eventkit:x" },
      { externalId: "p2", title: "Future soon", startsAt: at(3600), endsAt: at(5400), attendees: 2, hasCallLink: true, seriesId: "eventkit:x" },
      { externalId: "p3", title: "Future later", startsAt: at(90000), endsAt: at(93600), attendees: 2, hasCallLink: true, seriesId: "eventkit:x" },
    ]);
    const map = nextOccurrenceIds(t.db, ["eventkit:x", "eventkit:none"], new Date(at(0)));
    expect(map.get("eventkit:x")).toBe(eventBy(t, "p2").id);
    expect(map.has("eventkit:none")).toBe(false);
  });

  it("returns nothing for a series with no more occurrences scheduled", () => {
    replaceCalendarEvents(t.db, [
      { externalId: "q1", title: "Done", startsAt: at(-7200), endsAt: at(-5400), attendees: 2, hasCallLink: true, seriesId: "eventkit:y" },
    ]);
    const map = nextOccurrenceIds(t.db, ["eventkit:y"], new Date(at(0)));
    expect(map.has("eventkit:y")).toBe(false);
  });
});
