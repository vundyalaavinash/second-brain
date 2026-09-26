import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { items } from "@/db/schema";
import { archiveItem, createItem, getItem, parseMeta, updateItem } from "@/domain/items";
import { setSetting } from "@/domain/settings";
import type { RecordingMeta } from "./recorder";
import {
  AUDIO_RETENTION_KEY,
  DEFAULT_AUDIO_RETENTION_DAYS,
  audioFootprint,
  audioRetentionDays,
  readAudioFootprintSnapshot,
  recordAudioFootprint,
  releasableRecordings,
  releaseAudio,
  setAudioRetentionDays,
  sweepOrphanAudio,
} from "./audio-retention";

const STARTED_AT = "2026-08-01T10:00:00.000Z";
const NOW = new Date("2026-09-25T12:00:00.000Z");

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

interface Opts {
  title?: string;
  /** When explicitly `null`, the recording has no `endedAt` -- still recording. Defaults to
   * `STARTED_AT`, well in the past. */
  endedAt?: string | null;
  /** The transcript text (`item.extractedText`). Omitted, or whitespace-only, means no
   * transcript at all. */
  transcript?: string;
  /** Meta claims the transcript is ready without necessarily having a real one -- the flag the
   * rule must not trust. */
  claimedFinal?: boolean;
  audioReleasedAt?: string;
  bytes?: number;
  archived?: boolean;
  /** Meta points at a wav that is never actually written to disk. */
  noFile?: boolean;
}

function writeWav(t: TestDb, wavPath: string, bytes: number): void {
  const file = path.join(t.dir, "files", wavPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
}

let counter = 0;

/** A meeting item shaped like a finished recording, with its wav actually on disk unless
 * `noFile` is set. */
function meetingWith(t: TestDb, opts: Opts = {}): number {
  counter += 1;
  const wavPath = `meetings/${opts.title ?? "meeting"}-${counter}.wav`;
  const recording: RecordingMeta = {
    startedAt: STARTED_AT,
    endedAt: opts.endedAt === null ? undefined : (opts.endedAt ?? STARTED_AT),
    wavPath,
    state: "done",
    autoStarted: false,
  };
  const meta: Record<string, unknown> = { recording };
  if (opts.claimedFinal) meta.final_transcript_ready = true;
  if (opts.audioReleasedAt) meta.audioReleasedAt = opts.audioReleasedAt;

  const item = createItem(t.db, { type: "meeting", title: opts.title ?? "Meeting", status: "ready", meta });
  if (opts.transcript !== undefined) updateItem(t.db, item.id, { extractedText: opts.transcript });
  if (!opts.noFile) writeWav(t, wavPath, opts.bytes ?? 2000);
  if (opts.archived) archiveItem(t.db, item.id);
  return item.id;
}

function wavFile(t: TestDb, wavPath: string): string {
  return path.join(t.dir, "files", wavPath);
}

describe("audioRetentionDays", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("defaults to seven days", () => {
    expect(audioRetentionDays(t.db)).toBe(DEFAULT_AUDIO_RETENTION_DAYS);
  });

  it("stores and reads back a day count, and null for keep forever", () => {
    setAudioRetentionDays(t.db, 30);
    expect(audioRetentionDays(t.db)).toBe(30);
    setAudioRetentionDays(t.db, 0);
    expect(audioRetentionDays(t.db)).toBe(0);
    setAudioRetentionDays(t.db, null);
    expect(audioRetentionDays(t.db)).toBeNull();
  });

  it("rejects a day count outside 0-365, and out-of-range values already stored", () => {
    expect(() => setAudioRetentionDays(t.db, -1)).toThrow();
    expect(() => setAudioRetentionDays(t.db, 366)).toThrow();
    expect(() => setAudioRetentionDays(t.db, 1.5)).toThrow();
    setSetting(t.db, AUDIO_RETENTION_KEY, "not a number");
    expect(audioRetentionDays(t.db)).toBe(DEFAULT_AUDIO_RETENTION_DAYS);
  });

  it("finding 5: falls back to the default for an empty or blank stored value, never 0 -- the most destructive reading", () => {
    // Number("") is 0, not NaN, and 0 means "release as soon as a transcript exists": the most
    // aggressive value this setting has. A blank value must land on the safe default instead.
    setSetting(t.db, AUDIO_RETENTION_KEY, "");
    expect(audioRetentionDays(t.db)).toBe(DEFAULT_AUDIO_RETENTION_DAYS);
    setSetting(t.db, AUDIO_RETENTION_KEY, "   ");
    expect(audioRetentionDays(t.db)).toBe(DEFAULT_AUDIO_RETENTION_DAYS);
  });
});

describe("releasableRecordings", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("never releases audio that has no transcript, however old", () => {
    // A recording from well over a year ago whose transcription never ran or produced nothing.
    // If the audio goes, the meeting is gone -- this is the only copy of what was said.
    const item = meetingWith(t, { title: "Untranscribed", endedAt: isoDaysAgo(400) });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("checks for the transcript at the moment of deletion, not from a flag set earlier", () => {
    // Meta claims the transcript is ready; the transcript itself is an empty string. This is
    // exactly the shape that loses a meeting if the check ever trusts the flag instead.
    const item = meetingWith(t, { title: "Claimed", endedAt: isoDaysAgo(30), claimedFinal: true, transcript: "" });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
    expect(parseMeta<{ final_transcript_ready?: boolean }>(getItem(t.db, item)!).final_transcript_ready).toBe(true);
  });

  it("treats a whitespace-only transcript as absent", () => {
    const item = meetingWith(t, { title: "Whitespace", endedAt: isoDaysAgo(30), transcript: "   \n\t  " });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("finding 7: treats a transcript of only zero-width characters as absent", () => {
    // String.prototype.trim() does not recognise the zero-width space, zero-width joiners, or
    // the word joiner as whitespace, unlike ordinary whitespace, NBSP, and the BOM.
    const item = meetingWith(t, { title: "Zero width", endedAt: isoDaysAgo(30), transcript: "​‌‍⁠" });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("releases a transcribed recording past the window", () => {
    const item = meetingWith(t, { title: "Past window", endedAt: isoDaysAgo(8), transcript: "we agreed to ship on Friday" });
    const list = releasableRecordings(t.db, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemId: item, bytes: 2000 });
  });

  it("keeps a transcribed recording that is still inside the window", () => {
    const item = meetingWith(t, { title: "Inside window", endedAt: isoDaysAgo(2), transcript: "notes" });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("releases as soon as there is a transcript when the window is zero", () => {
    setAudioRetentionDays(t.db, 0);
    const item = meetingWith(t, { title: "Zero window", endedAt: isoDaysAgo(0), transcript: "just finished" });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).toContain(item);
  });

  it("never releases anything when the setting is null, however old and however transcribed", () => {
    setAudioRetentionDays(t.db, null);
    meetingWith(t, { title: "Forever", endedAt: isoDaysAgo(400), transcript: "keep this forever" });
    expect(releasableRecordings(t.db, NOW)).toEqual([]);
  });

  it("skips an item that has already been released", () => {
    const item = meetingWith(t, { title: "Already", endedAt: isoDaysAgo(30), transcript: "done", audioReleasedAt: isoDaysAgo(1) });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("skips a recording that is still going (no endedAt)", () => {
    const item = meetingWith(t, { title: "Live", endedAt: null, transcript: "partial" });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).not.toContain(item);
  });

  it("considers an archived meeting's recording too", () => {
    const item = meetingWith(t, { title: "Archived", endedAt: isoDaysAgo(30), transcript: "wrapped up", archived: true });
    expect(releasableRecordings(t.db, NOW).map((r) => r.itemId)).toContain(item);
  });
});

describe("releaseAudio", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("releases a transcribed recording past the window and keeps the transcript", () => {
    const item = meetingWith(t, { title: "Ship it", endedAt: isoDaysAgo(8), transcript: "we agreed to ship on Friday" });
    const wav = wavFile(t, parseMeta<{ recording: RecordingMeta }>(getItem(t.db, item)!).recording.wavPath);
    expect(fs.existsSync(wav)).toBe(true);

    const result = releaseAudio(t.db, item, NOW);
    expect(result).toEqual({ freedBytes: 2000 });
    expect(fs.existsSync(wav)).toBe(false);

    const after = getItem(t.db, item)!;
    expect(after.extractedText).toContain("ship on Friday");
    const meta = parseMeta<{ audioReleasedAt?: string }>(after);
    expect(meta.audioReleasedAt).toBe(NOW.toISOString());
  });

  it("never releases audio that has no transcript, called directly and however old", () => {
    const item = meetingWith(t, { title: "No transcript", endedAt: isoDaysAgo(400) });
    const wav = wavFile(t, parseMeta<{ recording: RecordingMeta }>(getItem(t.db, item)!).recording.wavPath);

    expect(releaseAudio(t.db, item, NOW)).toBeNull();
    expect(fs.existsSync(wav)).toBe(true);
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(t.db, item)!).audioReleasedAt).toBeUndefined();
  });

  it("refuses a transcript that is only whitespace", () => {
    const item = meetingWith(t, { title: "Blank", endedAt: isoDaysAgo(30), transcript: "   " });
    expect(releaseAudio(t.db, item, NOW)).toBeNull();
  });

  it("survives a wav that has already gone from disk, and still marks the item", () => {
    // Meta says there is a file; the file is not there. Releasing must not throw, and must
    // still mark the item so the page stops offering a player.
    const item = meetingWith(t, { title: "Vanished", endedAt: isoDaysAgo(30), transcript: "still here", noFile: true });
    let result: { freedBytes: number } | null = null;
    expect(() => {
      result = releaseAudio(t.db, item, NOW);
    }).not.toThrow();
    expect(result).toEqual({ freedBytes: 0 });
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(t.db, item)!).audioReleasedAt).toBe(NOW.toISOString());
    // A second call is now a no-op -- already released, so the mark stuck.
    expect(releaseAudio(t.db, item, NOW)).toBeNull();
  });

  it("returns null for an item with no recording at all", () => {
    const item = createItem(t.db, { type: "meeting", title: "Just notes" });
    expect(releaseAudio(t.db, item.id, NOW)).toBeNull();
  });

  it("returns null for an unknown item", () => {
    expect(releaseAudio(t.db, 999999, NOW)).toBeNull();
  });

  it("finding 6: refuses a wavPath that resolves outside files/meetings, and never touches that file", () => {
    const outside = path.join(t.dir, "files", "attachments", "important.pdf");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, Buffer.alloc(35));

    const recording: RecordingMeta = {
      startedAt: STARTED_AT,
      endedAt: isoDaysAgo(30),
      wavPath: "../attachments/important.pdf",
      state: "done",
      autoStarted: false,
    };
    const item = createItem(t.db, { type: "meeting", title: "Escape attempt", status: "ready", meta: { recording } });
    updateItem(t.db, item.id, { extractedText: "we agreed to ship on Friday" });

    expect(releaseAudio(t.db, item.id, NOW)).toBeNull();
    expect(fs.existsSync(outside)).toBe(true);
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(t.db, item.id)!).audioReleasedAt).toBeUndefined();
  });

  it("finding 8: ignores the retention window (documented, on purpose -- this is what the 'Remove the audio' action calls)", () => {
    setAudioRetentionDays(t.db, null); // "keep forever" -- releasableRecordings would return nothing at all
    const item = meetingWith(t, { title: "Manual override", endedAt: isoDaysAgo(1), transcript: "still there" });
    expect(releaseAudio(t.db, item, NOW)).not.toBeNull();
  });

  it("finding 8: stamps audioReleasedAt with whatever now says, even a rewound clock, though the rule that cannot be broken still holds", () => {
    const rewound = new Date("2019-01-01T00:00:00.000Z");
    const item = meetingWith(t, { title: "Rewound clock", endedAt: isoDaysAgo(30), transcript: "still transcribed" });
    expect(releaseAudio(t.db, item, rewound)).not.toBeNull();
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(t.db, item)!).audioReleasedAt).toBe(rewound.toISOString());

    // The rule that cannot be broken is unaffected by the clock: an untranscribed recording is
    // still refused regardless of what now says.
    const untranscribed = meetingWith(t, { title: "Rewound, no transcript", endedAt: isoDaysAgo(30) });
    expect(releaseAudio(t.db, untranscribed, rewound)).toBeNull();
  });
});

describe("sweepOrphanAudio", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("sweeps a wav no item points at, and leaves one that is pointed at", () => {
    const kept = meetingWith(t, { title: "Kept", endedAt: isoDaysAgo(1) });
    const keptWav = wavFile(t, parseMeta<{ recording: RecordingMeta }>(getItem(t.db, kept)!).recording.wavPath);
    const orphan = wavFile(t, "meetings/nobody-points-here.wav");
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, Buffer.alloc(500));

    const result = sweepOrphanAudio(t.db);
    expect(result).toEqual({ files: 1, bytes: 500 });
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(keptWav)).toBe(true);
  });

  it("does not sweep a wav an archived meeting still points at", () => {
    const archived = meetingWith(t, { title: "Archived", endedAt: isoDaysAgo(1), archived: true });
    const wav = wavFile(t, parseMeta<{ recording: RecordingMeta }>(getItem(t.db, archived)!).recording.wavPath);

    expect(sweepOrphanAudio(t.db)).toEqual({ files: 0, bytes: 0 });
    expect(fs.existsSync(wav)).toBe(true);
  });

  it("does not sweep a wav a recording already released still names", () => {
    // Released audio has no file on disk any more, but the still-referenced path must not be
    // treated as fair game if something were ever written back to that name.
    const released = meetingWith(t, { title: "Released", endedAt: isoDaysAgo(30), transcript: "done", audioReleasedAt: isoDaysAgo(1) });
    const wavPath = parseMeta<{ recording: RecordingMeta }>(getItem(t.db, released)!).recording.wavPath;
    const wav = wavFile(t, wavPath);
    fs.writeFileSync(wav, Buffer.alloc(10)); // as if something reused the name -- still referenced, must survive

    expect(sweepOrphanAudio(t.db)).toEqual({ files: 0, bytes: 0 });
    expect(fs.existsSync(wav)).toBe(true);
  });

  it("ignores a non-wav file and a directory under files/meetings", () => {
    const dir = path.join(t.dir, "files", "meetings");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "not audio");
    fs.mkdirSync(path.join(dir, "a-directory.wav"));

    expect(() => sweepOrphanAudio(t.db)).not.toThrow();
    expect(sweepOrphanAudio(t.db)).toEqual({ files: 0, bytes: 0 });
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "a-directory.wav"))).toBe(true);
  });

  it("does nothing when the meetings directory does not exist", () => {
    expect(sweepOrphanAudio(t.db)).toEqual({ files: 0, bytes: 0 });
  });

  it("finding 1: refuses to sweep anything -- not just the unreadable item's own file -- when any meeting item's meta cannot be read, and says which item", () => {
    // Reproduces the review's finding exactly: a live meeting with no transcript, whose meta
    // column has been truncated to invalid JSON (the shape a partial write or disk damage could
    // leave behind), sitting beside an ordinary kept recording and a genuine orphan.
    const kept = meetingWith(t, { title: "Kept", endedAt: isoDaysAgo(1) });
    const keptWav = wavFile(t, parseMeta<{ recording: RecordingMeta }>(getItem(t.db, kept)!).recording.wavPath);

    const live = createItem(t.db, { type: "meeting", title: "Live, no transcript", status: "processing" });
    t.db
      .update(items)
      .set({ meta: '{"recording":{"wavPath":"meetings/b.wav"' }) // deliberately truncated -- invalid JSON
      .where(eq(items.id, live.id))
      .run();
    writeWav(t, "meetings/b.wav", 900);

    const orphan = wavFile(t, "meetings/d-orphan.wav");
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, Buffer.alloc(29));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = sweepOrphanAudio(t.db);
    const logged = errorSpy.mock.calls.map((c) => String(c[0]));
    errorSpy.mockRestore();

    // Nothing is deleted at all -- an incomplete keep-set is not a keep-set, so even the genuine
    // orphan is left alone rather than trusting a partial reading of "what is referenced".
    expect(result).toEqual({ files: 0, bytes: 0 });
    expect(fs.existsSync(keptWav)).toBe(true);
    expect(fs.existsSync(wavFile(t, "meetings/b.wav"))).toBe(true);
    expect(fs.existsSync(orphan)).toBe(true);
    expect(logged.some((line) => line.includes(String(live.id)))).toBe(true);
  });

  it("finding 1: refuses a candidate whose own file name encodes a readable item with no transcript, even though nothing currently references that exact path", () => {
    // A second, independent guard on top of the referenced-paths set: cross-checks the file's
    // own name (Recorder.start's <itemId>-<startedAt>.wav convention) against a live lookup.
    const item = createItem(t.db, { type: "meeting", title: "Re-recorded", status: "processing" });
    const stray = wavFile(t, `meetings/${item.id}-stray.wav`);
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, Buffer.alloc(40));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(sweepOrphanAudio(t.db)).toEqual({ files: 0, bytes: 0 });
    errorSpy.mockRestore();
    expect(fs.existsSync(stray)).toBe(true);

    // Once that item has a transcript, the same stray file is a genuine orphan and is swept.
    updateItem(t.db, item.id, { extractedText: "the actual transcript" });
    expect(sweepOrphanAudio(t.db)).toEqual({ files: 1, bytes: 40 });
    expect(fs.existsSync(stray)).toBe(false);
  });

  it("finding 1: a wav whose name encodes no item id (a genuine, nameless orphan) sweeps normally regardless of any item's transcript state", () => {
    meetingWith(t, { title: "Untranscribed elsewhere", endedAt: isoDaysAgo(1) }); // no transcript, irrelevant to this file
    const orphan = wavFile(t, "meetings/leftover.wav");
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, Buffer.alloc(12));

    expect(sweepOrphanAudio(t.db)).toEqual({ files: 1, bytes: 12 });
    expect(fs.existsSync(orphan)).toBe(false);
  });
});

describe("audioFootprint", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("reports nothing held when there is nothing", () => {
    expect(audioFootprint(t.db)).toEqual({ recordings: 0, bytes: 0, nextReleaseAt: null });
  });

  it("reports the footprint in bytes and when the next release is due", () => {
    meetingWith(t, { title: "Sooner", endedAt: isoDaysAgo(6), transcript: "sooner", bytes: 1000 });
    meetingWith(t, { title: "Later", endedAt: isoDaysAgo(1), transcript: "later", bytes: 3000 });

    const footprint = audioFootprint(t.db);
    expect(footprint.recordings).toBe(2);
    expect(footprint.bytes).toBe(4000);
    // "Sooner" ended six days ago; with the default seven-day window it is due tomorrow --
    // sooner than "Later", which ended yesterday.
    expect(Date.parse(footprint.nextReleaseAt!)).toBe(Date.parse(isoDaysAgo(6)) + DEFAULT_AUDIO_RETENTION_DAYS * 86_400_000);
  });

  it("counts a recording that has no transcript yet as held, but it never sets the next release date", () => {
    meetingWith(t, { title: "No transcript", endedAt: isoDaysAgo(30), bytes: 5000 });
    const footprint = audioFootprint(t.db);
    expect(footprint.recordings).toBe(1);
    expect(footprint.bytes).toBe(5000);
    expect(footprint.nextReleaseAt).toBeNull();
  });

  it("does not count a released recording, or one whose file is already gone", () => {
    meetingWith(t, { title: "Released", endedAt: isoDaysAgo(30), transcript: "gone", audioReleasedAt: isoDaysAgo(1) });
    meetingWith(t, { title: "Missing file", endedAt: isoDaysAgo(30), transcript: "vanished", noFile: true });
    expect(audioFootprint(t.db)).toEqual({ recordings: 0, bytes: 0, nextReleaseAt: null });
  });

  it("reports nothing due when the setting is null, even with recordings held", () => {
    setAudioRetentionDays(t.db, null);
    meetingWith(t, { title: "Forever", endedAt: isoDaysAgo(30), transcript: "kept" });
    const footprint = audioFootprint(t.db);
    expect(footprint.recordings).toBe(1);
    expect(footprint.nextReleaseAt).toBeNull();
  });
});

describe("recordAudioFootprint / readAudioFootprintSnapshot", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("finding 4: reads all-zero before anything has ever recorded a snapshot -- never a live scan", () => {
    meetingWith(t, { title: "Held but never snapshotted", endedAt: isoDaysAgo(1), transcript: "x" });
    // A live audioFootprint would see this recording; the snapshot reader must not.
    expect(audioFootprint(t.db).recordings).toBe(1);
    expect(readAudioFootprintSnapshot(t.db)).toEqual({ recordings: 0, bytes: 0, nextReleaseAt: null });
  });

  it("persists exactly what audioFootprint computed at the moment it was recorded", () => {
    meetingWith(t, { title: "Held", endedAt: isoDaysAgo(6), transcript: "x", bytes: 1234 });
    const live = audioFootprint(t.db);

    recordAudioFootprint(t.db, NOW);
    expect(readAudioFootprintSnapshot(t.db)).toEqual(live);
  });

  it("stays put after the underlying state changes, until recorded again -- proving it is a snapshot, not a passthrough", () => {
    const item = meetingWith(t, { title: "Held", endedAt: isoDaysAgo(6), transcript: "x" });
    recordAudioFootprint(t.db, NOW);
    expect(readAudioFootprintSnapshot(t.db).recordings).toBe(1);

    releaseAudio(t.db, item, NOW);
    // The live state has changed (nothing held any more) but the snapshot has not been re-recorded.
    expect(audioFootprint(t.db).recordings).toBe(0);
    expect(readAudioFootprintSnapshot(t.db).recordings).toBe(1);

    recordAudioFootprint(t.db, NOW);
    expect(readAudioFootprintSnapshot(t.db).recordings).toBe(0);
  });
});
