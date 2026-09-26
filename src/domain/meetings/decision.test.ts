import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { calendarEvents, meetingSeriesDecisions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { replaceCalendarEvents } from "@/domain/activity/calendar";
import { MeetingError } from "./errors";
import { effectiveDecision, seriesDecisionsFor, setMeetingDecision } from "./decision";

const T0 = Date.parse("2026-09-16T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

describe("effectiveDecision", () => {
  it("an occurrence override wins over a series decision", () => {
    expect(effectiveDecision({ status: "accepted", decision: "not-going" }, "going")).toBe("not-going");
  });

  it("a series decision applies when no occurrence override exists", () => {
    expect(effectiveDecision({ status: "accepted", decision: null }, "not-going")).toBe("not-going");
  });

  it("falls back to the calendar's own status when neither is set", () => {
    expect(effectiveDecision({ status: "declined", decision: null }, null)).toBe("not-going");
    expect(effectiveDecision({ status: "accepted", decision: null }, null)).toBe("going");
    expect(effectiveDecision({ status: "none", decision: null }, null)).toBe("going");
  });

  it("never infers maybe from a tentative calendar status", () => {
    expect(effectiveDecision({ status: "tentative", decision: null }, null)).toBe("going");
  });
});

describe("setMeetingDecision / seriesDecisionsFor", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  function event(externalId: string, seriesId?: string) {
    replaceCalendarEvents(t.db, [
      { externalId, title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: false, seriesId },
    ]);
    return t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, externalId)).get()!;
  }

  it("writes an occurrence-scoped decision onto the event row only", () => {
    const ev = event("a");
    setMeetingDecision(t.db, ev.id, { decision: "maybe", note: "checking my day", scope: "occurrence" });
    const updated = t.db.select().from(calendarEvents).where(eq(calendarEvents.id, ev.id)).get()!;
    expect(updated.decision).toBe("maybe");
    expect(updated.decisionNote).toBe("checking my day");
  });

  it("refuses a series-scoped decision on an event with no seriesId", () => {
    const ev = event("a");
    expect(() => setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" })).toThrow(MeetingError);
    try {
      setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" });
    } catch (err) {
      expect((err as MeetingError).status).toBe(400);
    }
  });

  it("throws for an event that does not exist", () => {
    expect(() => setMeetingDecision(t.db, 999999, { decision: "going", scope: "occurrence" })).toThrow(MeetingError);
  });

  it("writes a series-scoped decision that seriesDecisionsFor then resolves for that series", () => {
    const ev = event("a", "eventkit:series-1");
    setMeetingDecision(t.db, ev.id, { decision: "not-going", note: "conflict", scope: "series" });
    const decisions = seriesDecisionsFor(t.db, ["eventkit:series-1"]);
    expect(decisions.get("eventkit:series-1")).toBe("not-going");
  });

  it("a later series-scoped write on the same series replaces the earlier one", () => {
    const ev = event("a", "eventkit:series-1");
    setMeetingDecision(t.db, ev.id, { decision: "maybe", scope: "series" });
    setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" });
    expect(seriesDecisionsFor(t.db, ["eventkit:series-1"]).get("eventkit:series-1")).toBe("not-going");
  });

  // Finding 2: an occurrence override outranks a series decision (effectiveDecision's own
  // ordering), so a series write that leaves a stale override in place on the row it was issued
  // from would make "every time" visibly do nothing to that very meeting.
  it("a series-scoped write clears the occurrence override on the row it was issued from", () => {
    const ev = event("a", "eventkit:series-1");
    setMeetingDecision(t.db, ev.id, { decision: "maybe", note: "checking", scope: "occurrence" });
    setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" });
    const updated = t.db.select().from(calendarEvents).where(eq(calendarEvents.id, ev.id)).get()!;
    expect(updated.decision).toBeNull();
    expect(updated.decisionNote).toBe("");
    const seriesDecision = seriesDecisionsFor(t.db, ["eventkit:series-1"]).get("eventkit:series-1") ?? null;
    expect(effectiveDecision(updated, seriesDecision)).toBe("not-going");
  });

  it("a series-scoped write does not touch a sibling occurrence's own override", () => {
    // Both occurrences must be seeded in one call: `replaceCalendarEvents` purges same-day rows
    // that a later call does not re-send, and the `event()` helper above calls it once per event.
    replaceCalendarEvents(t.db, [
      { externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: false, seriesId: "eventkit:series-1" },
      { externalId: "b", title: "Weekly sync", startsAt: at(3600), endsAt: at(5400), attendees: 4, hasCallLink: false, seriesId: "eventkit:series-1" },
    ]);
    const first = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "a")).get()!;
    const second = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "b")).get()!;
    setMeetingDecision(t.db, second.id, { decision: "maybe", note: "my own answer", scope: "occurrence" });
    setMeetingDecision(t.db, first.id, { decision: "not-going", scope: "series" });
    const untouched = t.db.select().from(calendarEvents).where(eq(calendarEvents.id, second.id)).get()!;
    expect(untouched.decision).toBe("maybe");
    expect(untouched.decisionNote).toBe("my own answer");
  });

  // Finding 3: a PATCH that omits `note` must not blank one that is already there.
  it("an occurrence-scoped write with no note leaves an existing note alone", () => {
    const ev = event("a");
    setMeetingDecision(t.db, ev.id, { decision: "maybe", note: "checking my day", scope: "occurrence" });
    setMeetingDecision(t.db, ev.id, { decision: "going", scope: "occurrence" });
    const updated = t.db.select().from(calendarEvents).where(eq(calendarEvents.id, ev.id)).get()!;
    expect(updated.decision).toBe("going");
    expect(updated.decisionNote).toBe("checking my day");
  });

  it("a series-scoped write with no note leaves the series' existing note alone", () => {
    const ev = event("a", "eventkit:series-1");
    setMeetingDecision(t.db, ev.id, { decision: "maybe", note: "conflict", scope: "series" });
    setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" });
    const stored = t.db.select().from(meetingSeriesDecisions).get();
    expect(stored?.note).toBe("conflict");
    expect(stored?.decision).toBe("not-going");
  });

  it("one query resolves series decisions for a list of ids, not one per id", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `eventkit:series-${i}`);
    for (const id of ids) {
      const ev = event(`ext-${id}`, id);
      setMeetingDecision(t.db, ev.id, { decision: "not-going", scope: "series" });
    }
    const spy = vi.spyOn(t.db, "select");
    const decisions = seriesDecisionsFor(t.db, ids);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(decisions.size).toBe(10);
    expect(decisions.get(ids[0])).toBe("not-going");
    expect(decisions.get(ids[9])).toBe("not-going");
  });

  it("an empty list of ids costs no query at all", () => {
    const spy = vi.spyOn(t.db, "select");
    expect(seriesDecisionsFor(t.db, [])).toEqual(new Map());
    expect(spy).not.toHaveBeenCalled();
  });
});
