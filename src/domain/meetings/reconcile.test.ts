import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Item } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta } from "@/domain/items";
import { listJobs } from "@/jobs/queue";
import { setRecorder } from "./index";
import type { RecordingMeta } from "./recorder";
import { reconcileRecordings, stopForShutdown } from "./reconcile";

const STARTED_AT = "2026-09-22T10:00:00.000Z";

function meeting(t: TestDb, title: string, recording: Partial<RecordingMeta> | null, status: Item["status"] = "processing"): number {
  const meta = recording
    ? { recording: { startedAt: STARTED_AT, wavPath: `meetings/${title}.wav`, state: "recording", autoStarted: true, ...recording } satisfies RecordingMeta }
    : {};
  return createItem(t.db, { type: "meeting", title, status, meta }).id;
}

/** A WAV with `bytes` of audio after its 44-byte header, or just the header when 0. */
function writeWav(t: TestDb, wavPath: string, bytes: number): void {
  const file = path.join(t.dir, "files", wavPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(44 + bytes));
}

function recordingOf(t: TestDb, id: number): RecordingMeta | undefined {
  return parseMeta<{ recording?: RecordingMeta }>(getItem(t.db, id)!).recording;
}

describe("reconcileRecordings", () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
    setRecorder(null);
  });
  afterEach(() => t.cleanup());

  it("keeps a stranded session that has audio on disk and queues its transcript", () => {
    const id = meeting(t, "Kept", null);
    const withWav = meeting(t, "Product sync", {});
    writeWav(t, `meetings/Product sync.wav`, 3200);

    const log = vi.fn();
    expect(reconcileRecordings(t.db, log)).toEqual({ done: 1, failed: 0 });

    const recording = recordingOf(t, withWav)!;
    expect(recording.state).toBe("done");
    expect(typeof recording.endedAt).toBe("string");
    expect(listJobs(t.db, { itemId: withWav }).map((j) => j.type)).toEqual(["transcribe_final"]);
    expect(JSON.parse(listJobs(t.db, { itemId: withWav })[0].payload)).toEqual({ itemId: withWav, source: "recording" });
    expect(log).toHaveBeenCalledTimes(1);
    // An item that was never recording is none of this sweep's business.
    expect(getItem(t.db, id)!.status).toBe("processing");
  });

  it("fails a stranded session with nothing recorded, and hands the item back", () => {
    const missing = meeting(t, "Nothing", {});
    const headerOnly = meeting(t, "Header only", {});
    writeWav(t, "meetings/Header only.wav", 0);

    expect(reconcileRecordings(t.db)).toEqual({ done: 0, failed: 2 });

    for (const id of [missing, headerOnly]) {
      expect(recordingOf(t, id)!.state).toBe("error");
      expect(typeof recordingOf(t, id)!.endedAt).toBe("string");
      expect(getItem(t.db, id)!.status).toBe("ready");
      expect(listJobs(t.db, { itemId: id })).toEqual([]);
    }
  });

  it("leaves a finished session and a meeting that never recorded alone", () => {
    const done = meeting(t, "Yesterday", { state: "done", endedAt: STARTED_AT }, "ready");
    const plain = meeting(t, "Just a meeting", null, "ready");

    expect(reconcileRecordings(t.db)).toEqual({ done: 0, failed: 0 });

    expect(recordingOf(t, done)!.state).toBe("done");
    expect(recordingOf(t, done)!.endedAt).toBe(STARTED_AT);
    expect(getItem(t.db, plain)!.status).toBe("ready");
    expect(listJobs(t.db, {})).toEqual([]);
  });

  it("leaves the session the controller is running right now", () => {
    const live = meeting(t, "Live", {});
    writeWav(t, "meetings/Live.wav", 3200);
    setRecorder({ status: () => ({ state: "recording", itemId: live }) } as never);

    expect(reconcileRecordings(t.db)).toEqual({ done: 0, failed: 0 });
    expect(recordingOf(t, live)!.state).toBe("recording");
    setRecorder(null);
  });
});

describe("stopForShutdown", () => {
  it("asks the controller to stop", async () => {
    const stop = vi.fn(async () => ({ state: "idle" }));
    await stopForShutdown({ stop, timeoutMs: 1000 });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("gives up on a stop that hangs rather than holding the shutdown", async () => {
    const log = vi.fn();
    const started = Date.now();
    await stopForShutdown({ stop: () => new Promise<void>(() => {}), timeoutMs: 20, log });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(log.mock.calls[0][0]).toMatch(/did not stop/);
  });

  it("swallows a stop that throws", async () => {
    const log = vi.fn();
    await stopForShutdown({ stop: () => Promise.reject(new Error("no helper")), timeoutMs: 1000, log });
    expect(log.mock.calls[0][0]).toMatch(/no helper/);
  });
});
