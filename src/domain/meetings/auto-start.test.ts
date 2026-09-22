import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calendarEvents, type CalendarEvent } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta } from "@/domain/items";
import { replaceCalendarEvents, setMeetingNoRecord, type CalendarEventInput } from "@/domain/activity/calendar";
import { setSetting } from "@/domain/settings";
import { Recorder, type RecordingMeta } from "./recorder";
import { recorderStatus, keepRecording, setRecorder, startRecording } from "./index";
import { autoStartTick, autoStopDue, getAutoRecordSettings, pickAutoStart, setAutoRecordSettings } from "./auto-start";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_RECORDER = path.join(here, "..", "..", "test", "fake-recorder.js");

/** A fixed "now" in local time, so the day strings the query uses are the fixtures' days. */
const NOW = new Date();
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const ON = { autoRecord: true, autoRecordNeedsCallLink: true };

function event(over: Partial<CalendarEventInput> & { externalId: string; title: string; startsAt: string }): CalendarEventInput {
  return {
    endsAt: new Date(Date.parse(over.startsAt) + 30 * 60_000).toISOString(),
    attendees: 3,
    hasCallLink: true,
    joinUrl: "https://meet.example.com/x",
    ...over,
  };
}

function byTitle(t: TestDb, title: string): CalendarEvent {
  return t.db.select().from(calendarEvents).where(eq(calendarEvents.title, title)).get()!;
}

describe("pickAutoStart", () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  /** Every exclusion starts before the match, so a leak returns the wrong meeting, not none. */
  function seedExclusionsAndOneMatch(): void {
    replaceCalendarEvents(t.db, [
      event({ externalId: "gone", title: "Ended long ago", startsAt: at(-10) }),
      event({ externalId: "declined", title: "Declined", startsAt: at(-2), status: "declined" }),
      event({ externalId: "allday", title: "All day", startsAt: at(-2), allDay: true }),
      event({ externalId: "nolink", title: "No link", startsAt: at(-1), joinUrl: null, hasCallLink: false }),
      event({ externalId: "recorded", title: "Already recorded", startsAt: at(-1) }),
      event({ externalId: "norecord", title: "Not this one", startsAt: at(-1) }),
      event({ externalId: "match", title: "Weekly sync", startsAt: at(0) }),
      event({ externalId: "later", title: "Too far ahead", startsAt: at(5) }),
    ]);
    const recorded = createItem(t.db, {
      type: "meeting",
      title: "Already recorded",
      meta: { recording: { startedAt: at(-1), wavPath: "meetings/1.wav", state: "done", autoStarted: false } satisfies RecordingMeta },
    });
    t.db.update(calendarEvents).set({ itemId: recorded.id }).where(eq(calendarEvents.externalId, "recorded")).run();
    setMeetingNoRecord(t.db, byTitle(t, "Not this one").id, true);
  }

  it("takes the meeting starting now and skips declined, all-day, linkless, recorded, no-record, and out-of-window", () => {
    seedExclusionsAndOneMatch();
    expect(pickAutoStart(t.db, NOW, ON)?.title).toBe("Weekly sync");
  });

  it("takes a linkless meeting once the call-link rule is off", () => {
    replaceCalendarEvents(t.db, [event({ externalId: "nolink", title: "Desk chat", startsAt: at(0), joinUrl: null, hasCallLink: false })]);
    expect(pickAutoStart(t.db, NOW, ON)).toBeNull();
    expect(pickAutoStart(t.db, NOW, { autoRecord: true, autoRecordNeedsCallLink: false })?.title).toBe("Desk chat");
  });

  it("holds the window at two minutes late and one minute early, and picks nothing while auto-record is off", () => {
    replaceCalendarEvents(t.db, [event({ externalId: "m", title: "Standup", startsAt: at(0) })]);
    const ev = byTitle(t, "Standup");
    const start = new Date(Date.parse(ev.startsAt));
    const after = (ms: number) => new Date(start.getTime() + ms);
    expect(pickAutoStart(t.db, after(2 * 60_000), ON)?.id).toBe(ev.id);
    expect(pickAutoStart(t.db, after(2 * 60_000 + 1000), ON)).toBeNull();
    expect(pickAutoStart(t.db, after(-60_000), ON)?.id).toBe(ev.id);
    expect(pickAutoStart(t.db, after(-61_000), ON)).toBeNull();
    expect(pickAutoStart(t.db, start, { autoRecord: false, autoRecordNeedsCallLink: true })).toBeNull();
  });

  it("reads and writes the two settings, off and link-only by default", () => {
    expect(getAutoRecordSettings(t.db)).toEqual({ autoRecord: false, autoRecordNeedsCallLink: true });
    expect(setAutoRecordSettings(t.db, { autoRecord: true })).toEqual({ autoRecord: true, autoRecordNeedsCallLink: true });
    expect(setAutoRecordSettings(t.db, { autoRecordNeedsCallLink: false })).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false });
    expect(getAutoRecordSettings(t.db)).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false });
  });
});

describe("the auto-record tick", () => {
  let t: TestDb;
  let recorder: Recorder;

  beforeEach(() => {
    t = makeTestDb();
    recorder = new Recorder({ db: t.db, recorderBin: FAKE_RECORDER, whisperBin: null, baseModel: null, filesDir: path.join(t.dir, "files") });
    setRecorder(recorder);
    setSetting(t.db, "meetings.autoRecord", "1");
  });

  afterEach(async () => {
    await recorder.stop();
    setRecorder(null);
    t.cleanup();
  });

  it("starts the meeting that is beginning, and marks the recording as auto-started", async () => {
    replaceCalendarEvents(t.db, [event({ externalId: "m", title: "Weekly sync", startsAt: at(0) })]);

    await autoStartTick(t.db, { now: () => NOW });

    const status = recorderStatus();
    expect(status.state).toBe("recording");
    expect(status.title).toBe("Weekly sync");
    expect(status.autoStarted).toBe(true);
    const item = getItem(t.db, status.itemId!)!;
    expect(parseMeta<{ recording?: RecordingMeta }>(item).recording?.autoStarted).toBe(true);
  });

  it("stops an auto-started session five minutes after the meeting ended", async () => {
    replaceCalendarEvents(t.db, [event({ externalId: "m", title: "Weekly sync", startsAt: at(0) })]);
    const ev = byTitle(t, "Weekly sync");
    startRecording(t.db, { calendarEventId: ev.id }, { autoStarted: true });
    const end = Date.parse(ev.endsAt);

    await autoStartTick(t.db, { now: () => new Date(end + 4 * 60_000) });
    expect(recorderStatus().state).toBe("recording");

    await autoStartTick(t.db, { now: () => new Date(end + 6 * 60_000) });
    expect(recorderStatus().state).toBe("idle");
  });

  it("leaves a kept session running past the end, and never stops one a person started", async () => {
    replaceCalendarEvents(t.db, [event({ externalId: "m", title: "Weekly sync", startsAt: at(0) })]);
    const ev = byTitle(t, "Weekly sync");
    startRecording(t.db, { calendarEventId: ev.id }, { autoStarted: true });
    const late = new Date(Date.parse(ev.endsAt) + 6 * 60_000);
    expect(keepRecording().keep).toBe(true);

    await autoStartTick(t.db, { now: () => late });
    expect(recorderStatus().state).toBe("recording");
    expect(autoStopDue(recorderStatus(), t.db, late)).toBe(false);

    await recorder.stop();
    startRecording(t.db, { calendarEventId: ev.id });
    expect(autoStopDue(recorderStatus(), t.db, late)).toBe(false);
  });
});
