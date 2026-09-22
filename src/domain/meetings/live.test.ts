import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta } from "@/domain/items";
import { LiveTranscriber, mergeTranscript, type LiveSegment } from "./live";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_WHISPER = path.join(here, "..", "..", "test", "fake-whisper.js");

const T1 = "2026-09-22T10:00:00.000Z";
const T2 = "2026-09-22T10:00:05.000Z";

describe("mergeTranscript", () => {
  it("keeps the first window whole", () => {
    expect(mergeTranscript([], "hello there", T1)).toEqual([{ at: T1, text: "hello there" }]);
  });

  it("drops the longest overlap the new window repeats", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there how" }];
    const merged = mergeTranscript(previous, "there how are you", T2);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(previous[0]);
    expect(merged[1]).toEqual({ at: T2, text: "are you" });
  });

  it("adds nothing when the window repeats what is already there", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there how" }];
    expect(mergeTranscript(previous, "hello there how", T2)).toEqual(previous);
  });

  it("adds nothing for an empty or blank window", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello" }];
    expect(mergeTranscript(previous, "", T2)).toEqual(previous);
    expect(mergeTranscript(previous, "   \n ", T2)).toEqual(previous);
    expect(mergeTranscript([], "  ", T1)).toEqual([]);
  });

  it("matches the overlap across segment boundaries and ignores case", () => {
    const previous: LiveSegment[] = [
      { at: T1, text: "hello there" },
      { at: T1, text: "how are" },
    ];
    const merged = mergeTranscript(previous, "How are you today", T2);
    expect(merged).toHaveLength(3);
    expect(merged[2]).toEqual({ at: T2, text: "you today" });
  });

  it("keeps a window that shares nothing with what came before", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there" }];
    const merged = mergeTranscript(previous, "completely different words", T2);
    expect(merged[1]).toEqual({ at: T2, text: "completely different words" });
  });
});

describe("LiveTranscriber", () => {
  let t: TestDb;
  let model: string;
  let live: LiveTranscriber;

  function segments(itemId: number): LiveSegment[] {
    return parseMeta<{ liveTranscript?: LiveSegment[] }>(getItem(t.db, itemId)!).liveTranscript ?? [];
  }

  beforeEach(() => {
    t = makeTestDb();
    model = path.join(t.dir, "ggml-base.en.bin");
    fs.writeFileSync(model, "not a real model");
  });

  afterEach(() => {
    live.stop();
    delete process.env.SB_FAKE_WHISPER_FAIL;
    t.cleanup();
  });

  function make(itemId: number): LiveTranscriber {
    live = new LiveTranscriber({ db: t.db, itemId, whisperBin: FAKE_WHISPER, model, windowMs: 50 });
    return live;
  }

  it("transcribes a window into the item and clears its scratch on stop", async () => {
    const item = createItem(t.db, { type: "meeting", title: "Standup" });
    const lt = make(item.id);
    const dir = lt.scratchDir;
    expect(fs.existsSync(dir)).toBe(true);

    lt.push(Buffer.alloc(16_000 * 2));
    await lt.runWindow();
    expect(segments(item.id)).toEqual([{ at: expect.any(String), text: "hello world" }]);

    lt.stop();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("drops a window that lands after the session ended", async () => {
    const item = createItem(t.db, { type: "meeting", title: "Standup" });
    const lt = make(item.id);
    lt.push(Buffer.alloc(16_000 * 2));

    const window = lt.runWindow();
    lt.stop();
    await window;
    expect(segments(item.id)).toEqual([]);
  });

  it("keeps going after a window fails, and says so only once", async () => {
    const item = createItem(t.db, { type: "meeting", title: "Standup" });
    const logged: string[] = [];
    live = new LiveTranscriber({ db: t.db, itemId: item.id, whisperBin: FAKE_WHISPER, model, windowMs: 50, log: (m) => logged.push(m) });
    live.push(Buffer.alloc(3200));

    process.env.SB_FAKE_WHISPER_FAIL = "1";
    await live.runWindow();
    await live.runWindow();
    expect(logged).toHaveLength(1);
    expect(segments(item.id)).toEqual([]);

    // The session is still live: the window after the failures transcribes as usual.
    delete process.env.SB_FAKE_WHISPER_FAIL;
    await live.runWindow();
    expect(segments(item.id).map((seg) => seg.text)).toEqual(["hello world"]);
    expect(logged).toHaveLength(1);
  });
});
