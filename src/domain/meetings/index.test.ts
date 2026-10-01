import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  // Recording a meeting that already has a transcript is allowed -- a meeting resumes, a stop is
  // hit by mistake -- but the final pass overwrites `transcript` wholesale, so the earlier one
  // has to be filed away rather than silently lost. The audio behind it is on a retention timer
  // and may already be gone, so there is no redoing it.
  it("files the previous transcript away when a meeting is recorded again", () => {
    const meeting = createItem(t.db, {
      type: "meeting",
      title: "Weekly",
      meta: {
        transcript: [{ start: 0, end: 1, text: "first pass" }],
        liveTranscript: [{ at: "2026-09-22T10:00:00.000Z", text: "heard live" }],
        final_transcript_ready: true,
        summary: { summary: "the old summary" },
        recording: { wavPath: "meetings/old.wav", startedAt: "2026-09-22T10:00:00.000Z", state: "done" },
      },
    });

    startRecording(t.db, { itemId: meeting.id });

    const meta = parseMeta<{ previousSessions?: { transcript?: unknown; liveTranscript?: unknown; wavPath?: string }[]; transcript?: unknown; summary?: unknown }>(
      getItem(t.db, meeting.id)!,
    );
    expect(meta.previousSessions).toHaveLength(1);
    expect(meta.previousSessions![0].transcript).toEqual([{ start: 0, end: 1, text: "first pass" }]);
    expect(meta.previousSessions![0].liveTranscript).toEqual([{ at: "2026-09-22T10:00:00.000Z", text: "heard live" }]);
    expect(meta.previousSessions![0].wavPath).toBe("meetings/old.wav");
    // The new session starts clean, so a stale transcript or summary cannot look like this one's.
    expect(meta.transcript).toBeUndefined();
    expect(meta.summary).toBeUndefined();
  });

  it("files nothing away for a meeting that has never been transcribed", () => {
    const meeting = createItem(t.db, { type: "meeting", title: "Fresh", meta: {} });
    startRecording(t.db, { itemId: meeting.id });
    const meta = parseMeta<{ previousSessions?: unknown[] }>(getItem(t.db, meeting.id)!);
    expect(meta.previousSessions).toBeUndefined();
  });

  it("stops and keeps through the singleton", async () => {
    startRecording(t.db, { adhoc: true }, { autoStarted: true });
    expect(keepRecording().keep).toBe(true);
    expect((await stopRecording()).state).toBe("idle");
    expect(recorderStatus()).toEqual({ state: "idle" });
  });

  it("keeps the controller on globalThis, so a second copy of the module sees the same session", async () => {
    // Next bundles instrumentation and the route handlers separately, so the module runs twice
    // in one process. `vi.resetModules()` is the closest a test gets to that second graph.
    const started = startRecording(t.db, { adhoc: true });
    vi.resetModules();
    const second = (await import("./index")) as typeof import("./index");

    expect(second.recorderStatus().state).toBe("recording");
    expect(second.recorderStatus().itemId).toBe(started.itemId);
    // And the other way round: a stop through the second copy ends the session the first sees.
    expect((await second.stopRecording()).state).toBe("idle");
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
