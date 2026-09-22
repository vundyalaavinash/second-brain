import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, getItemChunks, parseMeta } from "@/domain/items";
import { enqueueJob, listJobs } from "@/jobs/queue";
import { filesDir } from "@/lib/paths";
import type { Segment } from "@/domain/meetings/transcript";
import { createTranscribeFinalHandler } from "./transcribe-final";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_WHISPER = path.join(here, "..", "..", "test", "fake-whisper.js");
const FAKE_FFMPEG = path.join(here, "..", "..", "test", "fake-ffmpeg.js");

const TRANSCRIPT = "Hello world this is the meeting";

/** A 16 kHz mono WAV of silence, the shape the recorder writes. */
function writeWav(relative: string, frames = 16000): string {
  const data = Buffer.alloc(frames * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  const abs = path.join(filesDir(), relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.concat([head, data]));
  return relative;
}

interface MeetingMeta {
  transcript?: Segment[];
  final_transcript_ready?: boolean;
  liveTranscript?: unknown;
  recording?: { wavPath: string; state: string };
}

describe("transcribe_final handler", () => {
  let t: TestDb;
  let model: string;

  function handler(over: { hasChatKey?: () => boolean; ffmpegBin?: string | null } = {}) {
    return createTranscribeFinalHandler({
      db: t.db,
      whisperBin: FAKE_WHISPER,
      ffmpegBin: over.ffmpegBin === undefined ? null : over.ffmpegBin,
      finalModel: model,
      hasChatKey: over.hasChatKey ?? (() => false),
    });
  }

  beforeEach(() => {
    t = makeTestDb();
    model = path.join(t.dir, "ggml-medium.en.bin");
    fs.writeFileSync(model, "not a real model");
  });
  afterEach(() => t.cleanup());

  it("transcribes a recorded wav, chunks it, and queues the embedding", async () => {
    const wavPath = writeWav(path.join("meetings", "1-recording.wav"));
    const item = createItem(t.db, {
      type: "meeting",
      title: "Standup",
      status: "processing",
      meta: { recording: { wavPath, state: "done" }, liveTranscript: [{ at: "2026-09-22T10:00:00.000Z", text: "hello" }] },
    });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id, source: "recording" }, item.id);

    await handler()(job);

    const after = getItem(t.db, item.id)!;
    expect(after.extractedText).toBe(TRANSCRIPT);
    expect(after.status).toBe("ready");
    const m = parseMeta<MeetingMeta>(after);
    expect(m.transcript).toEqual([
      { start: 0, end: 1.5, text: "Hello world" },
      { start: 1.5, end: 3, text: "this is the meeting" },
    ]);
    expect(m.final_transcript_ready).toBe(true);
    expect("liveTranscript" in m).toBe(false);
    expect(getItemChunks(t.db, item.id).length).toBeGreaterThan(0);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["transcribe_final", "embed"]);
  });

  it("queues a summary as well when a chat key is configured", async () => {
    const wavPath = writeWav(path.join("meetings", "2-recording.wav"));
    const item = createItem(t.db, { type: "meeting", title: "Standup", meta: { recording: { wavPath, state: "done" } } });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id, source: "recording" }, item.id);

    await handler({ hasChatKey: () => true })(job);

    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["transcribe_final", "embed", "summarize_meeting"]);
  });

  it("converts a dropped-in audio file before transcribing it", async () => {
    const relative = path.join("2026", "09", "talk.m4a");
    const abs = path.join(filesDir(), relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from("not really audio"));
    const item = createItem(t.db, { type: "meeting", title: "talk", filePath: relative, mimeType: "audio/mp4", status: "processing" });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id, source: "upload" }, item.id);

    await handler({ ffmpegBin: FAKE_FFMPEG })(job);

    expect(getItem(t.db, item.id)!.extractedText).toBe(TRANSCRIPT);
    // The original upload is still the item's file: the conversion is scratch.
    expect(getItem(t.db, item.id)!.filePath).toBe(relative);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it("fails the item with a message when the audio is gone", async () => {
    const item = createItem(t.db, {
      type: "meeting",
      title: "Standup",
      meta: { recording: { wavPath: path.join("meetings", "missing.wav"), state: "done" } },
    });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id, source: "recording" }, item.id);

    await expect(handler()(job)).rejects.toThrow(/audio/i);
    const after = getItem(t.db, item.id)!;
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/audio/i);
  });

  it("fails the item when nothing on it points at audio", async () => {
    const item = createItem(t.db, { type: "meeting", title: "Standup" });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id }, item.id);
    await expect(handler()(job)).rejects.toThrow(/audio/i);
    expect(getItem(t.db, item.id)!.status).toBe("failed");
  });

  it("fails the item when whisper is not installed", async () => {
    const wavPath = writeWav(path.join("meetings", "3-recording.wav"));
    const item = createItem(t.db, { type: "meeting", title: "Standup", meta: { recording: { wavPath, state: "done" } } });
    const job = enqueueJob(t.db, "transcribe_final", { itemId: item.id, source: "recording" }, item.id);
    const run = createTranscribeFinalHandler({ db: t.db, whisperBin: null, ffmpegBin: null, finalModel: model, hasChatKey: () => false });
    await expect(run(job)).rejects.toThrow(/whisper/i);
    expect(getItem(t.db, item.id)!.status).toBe("failed");
  });
});
