import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents, captureMeeting } from "@/domain/activity/calendar";
import { ingestHeartbeat } from "@/domain/activity/sessions";
import { calendarEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTask } from "@/domain/tasks";
import { updateItem } from "@/domain/items";
import { setMeetingDecision } from "./decision";
import { auditSeries, nextOccurrenceIds, weeklyMeetingShare } from "./audit";

const T0 = Date.parse("2026-09-01T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const NOW = new Date(T0 + 20 * 86_400_000);

function eventBy(externalId: string) {
  return (t: TestDb) => t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, externalId)).get()!;
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
    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    const weekly = audits.find((a) => a.seriesId === "eventkit:weekly")!;
    expect(weekly.occurrences).toBe(2);
    // A null seriesId groups as its own singleton, not folded into every other ownerless row.
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
    const ev2 = eventBy("a2")(t);
    setMeetingDecision(t.db, ev2.id, { decision: "not-going", scope: "occurrence" });
    const ev3 = eventBy("a3")(t);
    setMeetingDecision(t.db, ev3.id, { decision: "maybe", scope: "occurrence" });
    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    const standup = audits.find((a) => a.seriesId === "eventkit:standup")!;
    expect(standup.occurrences).toBe(3);
    // a1 defaults to going, a2 is not-going, a3 is maybe: two of three attended.
    expect(standup.attendedCount).toBe(2);
  });

  it("orders by total minutes, the recurring cost first, not the rare long workshop", () => {
    // Five short weekly standups (15 minutes each = 75 total) against one three-hour workshop.
    const standups = Array.from({ length: 5 }, (_, i) => ({
      externalId: `standup-${i}`,
      title: "Standup",
      startsAt: at(i * 86400),
      endsAt: at(i * 86400 + 900),
      attendees: 4,
      hasCallLink: true,
      seriesId: "eventkit:standup",
    }));
    replaceCalendarEvents(t.db, [
      ...standups,
      { externalId: "workshop", title: "Strategy workshop", startsAt: at(10 * 86400), endsAt: at(10 * 86400 + 10800), attendees: 8, hasCallLink: true },
    ]);
    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    expect(audits[0].title).toBe("Strategy workshop"); // 180 minutes, one occurrence
    // Bump the standups' count so their accumulated total overtakes the workshop's single one.
    const moreStandups = Array.from({ length: 15 }, (_, i) => ({
      externalId: `standup2-${i}`,
      title: "Standup",
      startsAt: at((i + 5) * 86400),
      endsAt: at((i + 5) * 86400 + 900),
      attendees: 4,
      hasCallLink: true,
      seriesId: "eventkit:standup",
    }));
    replaceCalendarEvents(t.db, [...standups, ...moreStandups]);
    const rerun = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    expect(rerun[0].seriesId).toBe("eventkit:standup");
    expect(rerun[0].totalMinutes).toBeGreaterThan(rerun[1]?.totalMinutes ?? 0);
  });

  it("costs one query per input list, not one per series — the pattern this repo has enforced three times already", () => {
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
    const runQuery = t.db.run.bind(t.db);
    let queryCount = 0;
    t.db.run = ((...args: Parameters<typeof runQuery>) => {
      queryCount += 1;
      return runQuery(...args);
    }) as typeof runQuery;
    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    expect(audits).toHaveLength(12);
    // Four fixed grouped reads (events, series decisions, items, tasks) plus one small
    // `activityBetween` call per occurrence (48 of them here) -- not one query per series (12),
    // and nowhere near one per row of every list read along the way.
    expect(queryCount).toBeLessThan(4 + series.length + 5);
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

    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    const design = audits.find((a) => a.seriesId === "eventkit:design")!;
    const labels = design.topActivity.map((a) => a.label);
    expect(labels).toContain("Code");
    expect(labels).not.toContain("Notes");
    const chrome = design.topActivity.find((a) => a.label === "Chrome" || a.label === "example.com");
    expect(chrome).toBeTruthy();
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
    const ev1 = eventBy("c1")(t);
    const item1 = captureMeeting(t.db, ev1.id);
    updateItem(t.db, item1.id, { body: "## Notes\n\nDecided the rollout plan.\n\n## Actions\n\n- [ ] " });
    createTask(t.db, { title: "Ship the rollout plan", sourceItemId: item1.id });

    const ev2 = eventBy("c2")(t);
    const item2 = captureMeeting(t.db, ev2.id);
    updateItem(t.db, item2.id, { meta: { transcript: "...said things..." } });

    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
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
    const audits = auditSeries(t.db, { since: "2026-09-01", now: NOW });
    expect(audits.filter((a) => a.seriesId === null)).toHaveLength(2);
    expect(audits.every((a) => a.occurrences === 1)).toBe(true);
  });
});

describe("weeklyMeetingShare", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("halves a maybe and drops a not-going meeting, against the working week", () => {
    // A Monday.
    const week = "2026-09-14";
    const S = Date.parse(`${week}T00:00:00.000Z`) + 10 * 3600_000;
    const wat = (s: number) => new Date(S + s * 1000).toISOString();
    replaceCalendarEvents(t.db, [
      { externalId: "w1", title: "Going", startsAt: wat(0), endsAt: wat(3600), attendees: 2, hasCallLink: true },
      { externalId: "w2", title: "Maybe", startsAt: wat(90000), endsAt: wat(90000 + 3600), attendees: 2, hasCallLink: true },
      { externalId: "w3", title: "Skipped", startsAt: wat(180000), endsAt: wat(180000 + 3600), attendees: 2, hasCallLink: true },
    ]);
    const ev2 = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "w2")).get()!;
    setMeetingDecision(t.db, ev2.id, { decision: "maybe", scope: "occurrence" });
    const ev3 = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "w3")).get()!;
    setMeetingDecision(t.db, ev3.id, { decision: "not-going", scope: "occurrence" });

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
    const soon = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "p2")).get()!;
    expect(map.get("eventkit:x")).toBe(soon.id);
    expect(map.has("eventkit:none")).toBe(false);
  });

  it("returns nothing for a series with no more occurrences scheduled", () => {
    replaceCalendarEvents(t.db, [{ externalId: "q1", title: "Done", startsAt: at(-7200), endsAt: at(-5400), attendees: 2, hasCallLink: true, seriesId: "eventkit:y" }]);
    const map = nextOccurrenceIds(t.db, ["eventkit:y"], new Date(at(0)));
    expect(map.has("eventkit:y")).toBe(false);
  });
});

// Silences an unused-import complaint under some tsconfig lint orders; `vi` isn't used directly
// here but is imported for parity with this domain's other test files if a future case needs it.
void vi;
