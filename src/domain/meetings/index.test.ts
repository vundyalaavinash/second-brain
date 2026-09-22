import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { calendarEvents } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta } from "@/domain/items";
import { replaceCalendarEvents } from "@/domain/activity/calendar";
import { MeetingError } from "./errors";
import { Recorder } from "./recorder";
import { getRecorder, keepRecording, recorderStatus, setRecorder, startRecording, stopRecording } from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_RECORDER = path.join(here, "..", "..", "test", "fake-recorder.js");

const at = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString();

/** The status of the MeetingError `run` throws, so each refusal reads as one line. */
function refusal(run: () => unknown): number {
  try {
    run();
  } catch (err) {
    if (err instanceof MeetingError) return err.status;
    throw err;
  }
  throw new Error("expected a MeetingError");
}

describe("recording sessions", () => {
  let t: TestDb;
  let recorder: Recorder;

  beforeEach(() => {
    t = makeTestDb();
    recorder = new Recorder({
      db: t.db,
      recorderBin: FAKE_RECORDER,
      whisperBin: null,
      baseModel: null,
      filesDir: path.join(t.dir, "files"),
    });
    setRecorder(recorder);
  });

  afterEach(async () => {
    await recorder.stop();
    setRecorder(null);
    t.cleanup();
  });

  it("is idle until something starts", () => {
    expect(recorderStatus()).toEqual({ state: "idle" });
  });

  it("captures the calendar meeting it is asked to record", () => {
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: true }]);
    const ev = t.db.select().from(calendarEvents).get()!;

    const started = startRecording(t.db, { calendarEventId: ev.id });
    expect(started.state).toBe("recording");
    expect(started.title).toBe("Weekly sync");
    const item = getItem(t.db, started.itemId!)!;
    expect(item.type).toBe("meeting");
    expect(parseMeta<{ calendarEventId: number }>(item).calendarEventId).toBe(ev.id);
  });

  it("refuses a second session, and creates nothing on the way to refusing", () => {
    startRecording(t.db, { adhoc: true });
    const before = t.db.$client.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
    expect(() => startRecording(t.db, { adhoc: true })).toThrow(MeetingError);
    const after = t.db.$client.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it("records an existing meeting item, and refuses anything else", async () => {
    const meeting = createItem(t.db, { type: "meeting", title: "Retro" });
    expect(startRecording(t.db, { itemId: meeting.id }).itemId).toBe(meeting.id);
    await stopRecording();

    const note = createItem(t.db, { type: "note", title: "Not a meeting" });
    expect(refusal(() => startRecording(t.db, { itemId: note.id }))).toBe(400);
    expect(refusal(() => startRecording(t.db, { itemId: 9999 }))).toBe(404);
    expect(refusal(() => startRecording(t.db, {}))).toBe(400);
  });

  it("stops and keeps through the singleton", async () => {
    startRecording(t.db, { adhoc: true }, { autoStarted: true });
    expect(keepRecording().keep).toBe(true);
    expect((await stopRecording()).state).toBe("idle");
    expect(recorderStatus()).toEqual({ state: "idle" });
  });

  it("says what is missing rather than pretending it can record", () => {
    setRecorder(null);
    // Nothing is installed under the temp data dir, so the recorder binary is absent.
    expect(fs.existsSync(path.join(t.dir, "bin", "sb-recorder"))).toBe(false);
    expect(refusal(() => getRecorder(t.db))).toBe(503);
    expect(() => getRecorder(t.db)).toThrow(/recorder/);
  });
});
