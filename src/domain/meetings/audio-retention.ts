import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import { filesDir } from "@/lib/paths";
import { getItem, listItems, mergeItemMeta, parseMeta } from "@/domain/items";
import { getSetting, setSetting } from "@/domain/settings";
import type { RecordingMeta } from "./recorder";

/** Design §9.2: default seven days past the recording's end -- long enough to notice a bad
 * transcript and re-run it, short enough that a busy fortnight does not cost ten gigabytes. */
export const DEFAULT_AUDIO_RETENTION_DAYS = 7;
export const AUDIO_RETENTION_KEY = "meetings.audioRetentionDays";

/** More meetings than this app will ever hold in one lifetime, so a scan for "every meeting
 * item" through `listItems` never quietly truncates at its ordinary page-sized default -- the
 * rule that cannot be broken (§9.1) has to see all of them, not the newest hundred. */
const ALL_MEETINGS_LIMIT = 1_000_000;

/** The stored representation for "keep forever": not a number, so it can never be confused with
 * a parse failure on a numeric setting, which falls back to the default rather than to null. */
const FOREVER = "null";

interface MeetingMeta {
  recording?: RecordingMeta;
  /** Set once by `releaseAudio`; its presence is what "already released" means -- never inferred
   * from whether the file happens to still be on disk. */
  audioReleasedAt?: string;
  audioReleasedBytes?: number;
}

/**
 * `null` means keep forever, `0`-`365` the days past the recording's end. Anything stored that
 * does not parse to one of those falls back to the default -- the same defensive shape
 * `retentionDays` in `src/domain/activity/helper-state.ts` uses for its own setting.
 */
export function audioRetentionDays(db: DB): number | null {
  const raw = getSetting(db, AUDIO_RETENTION_KEY, String(DEFAULT_AUDIO_RETENTION_DAYS));
  if (raw === FOREVER) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : DEFAULT_AUDIO_RETENTION_DAYS;
}

export function setAudioRetentionDays(db: DB, days: number | null): void {
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) {
    throw new RangeError("audioRetentionDays must be null or an integer between 0 and 365");
  }
  setSetting(db, AUDIO_RETENTION_KEY, days === null ? FOREVER : String(days));
}

/** Every meeting item, including archived ones: the rule that cannot be broken applies to a
 * meeting wherever it currently sits, and `sweepOrphanAudio` needs the complete set of
 * referenced paths before it may delete anything -- exactly the discipline `pruneBackups` and
 * `sweepSidecars` in `jobs/handlers/backup.ts` already follow for their own owned files. */
function allMeetingItems(db: DB) {
  return listItems(db, { type: "meeting", includeArchived: true, limit: ALL_MEETINGS_LIMIT });
}

/** The transcript itself, never a flag recorded earlier: empty or whitespace-only counts as no
 * transcript at all, because that is indistinguishable from transcription having failed, never
 * having run, or having produced nothing. `item.extractedText` is the canonical transcript text
 * -- the same field `summarize-meeting.ts` reads as "the transcript" -- not `meta.transcript`
 * (whisper's raw timed segments) and never `meta.final_transcript_ready` (set once, when the
 * transcript first landed, and proves nothing about what is on the item right now). */
function hasTranscript(extractedText: string): boolean {
  return extractedText.trim().length > 0;
}

function absoluteWavPath(wavPath: string): string {
  return path.join(filesDir(), wavPath);
}

function statSizeOrZero(absolute: string): number {
  return statSize(absolute) ?? 0;
}

/** The file's size, or `null` when there is nothing at `absolute` to stat -- distinct from a
 * genuine zero-byte file, which callers that count "is this actually held" care about. */
function statSize(absolute: string): number | null {
  try {
    return fs.statSync(absolute).size;
  } catch {
    return null; // already gone from disk -- not this function's business to report an error over
  }
}

export interface ReleasableRecording {
  itemId: number;
  wavPath: string;
  bytes: number;
}

/**
 * Recordings past their window with a transcript that genuinely exists right now. THE RULE THAT
 * CANNOT BE BROKEN (design §9.1): a recording with no transcript, or only an empty one, is never
 * included here however old it is -- it is the only copy of what was said, and a retention
 * window is a promise about disposable data, which untranscribed audio is not. `windowDays ===
 * null` ("keep forever") short-circuits to nothing at all, and `0` means "past the window" is
 * true the moment a transcript exists, since `recording.endedAt` is already in the past by the
 * time a transcript can exist for it.
 */
export function releasableRecordings(db: DB, now: Date = new Date()): ReleasableRecording[] {
  const windowDays = audioRetentionDays(db);
  if (windowDays === null) return [];
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const out: ReleasableRecording[] = [];
  for (const item of allMeetingItems(db)) {
    const meta = parseMeta<MeetingMeta>(item);
    const recording = meta.recording;
    if (!recording?.wavPath || meta.audioReleasedAt) continue;
    if (!recording.endedAt) continue; // still recording, or never properly finished
    if (!hasTranscript(item.extractedText)) continue; // the rule that cannot be broken
    const dueAt = Date.parse(recording.endedAt) + windowMs;
    if (now.getTime() < dueAt) continue;
    out.push({ itemId: item.id, wavPath: recording.wavPath, bytes: statSizeOrZero(absoluteWavPath(recording.wavPath)) });
  }
  return out;
}

/**
 * Deletes one recording's audio and records that it happened. Re-checks the rule that cannot be
 * broken itself, at the moment of deletion, rather than trusting a caller that already filtered
 * through `releasableRecordings` -- the same "checked here, not assumed from upstream" discipline
 * design §9.1 asks for. Deletes with `{ force: true }` so a file already gone from disk is not an
 * error; `null` for anything that was never eligible (no recording, already released, or no
 * transcript), and the transcript itself is never touched either way.
 */
export function releaseAudio(db: DB, itemId: number, now: Date = new Date()): { freedBytes: number } | null {
  const item = getItem(db, itemId);
  if (!item) return null;
  const meta = parseMeta<MeetingMeta>(item);
  const recording = meta.recording;
  if (!recording?.wavPath || meta.audioReleasedAt) return null;
  if (!hasTranscript(item.extractedText)) return null; // the rule that cannot be broken, checked again, right here

  const absolute = absoluteWavPath(recording.wavPath);
  const freedBytes = statSizeOrZero(absolute);
  fs.rmSync(absolute, { force: true });
  mergeItemMeta(db, itemId, { audioReleasedAt: now.toISOString(), audioReleasedBytes: freedBytes });
  return { freedBytes };
}

/**
 * Deletes a `.wav` under `files/meetings` that no meeting item -- including an archived one --
 * currently points at: the orphan a deleted meeting leaves behind. One of only two things in
 * this whole design permitted to delete a file it did not write (`sweepSidecars` in
 * `jobs/handlers/backup.ts` is the other), so it builds the complete set of referenced paths from
 * every meeting item before deleting anything, the same shape `sweepSidecars` and `pruneBackups`
 * already use -- an earlier version of the sidecar sweep skipped exactly this step and destroyed
 * committed data in a reviewer's reproduction.
 */
export function sweepOrphanAudio(db: DB): { files: number; bytes: number } {
  const dir = path.join(filesDir(), "meetings");
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };

  const referenced = new Set<string>();
  for (const item of allMeetingItems(db)) {
    const wavPath = parseMeta<MeetingMeta>(item).recording?.wavPath;
    if (wavPath) referenced.add(path.resolve(absoluteWavPath(wavPath)));
  }

  const toDelete = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".wav"))
    .map((name) => path.join(dir, name))
    .filter((abs) => !referenced.has(path.resolve(abs)))
    .filter(isRegularFile); // never a directory, never a symlink either way it might resolve

  let files = 0;
  let bytes = 0;
  for (const abs of toDelete) {
    bytes += statSizeOrZero(abs);
    fs.rmSync(abs, { force: true });
    files += 1;
  }
  return { files, bytes };
}

/** A regular file only -- `lstatSync`, not `statSync`, so a symlink is judged as itself and never
 * as whatever it happens to point to. Same discipline as `isRegularFile` in `jobs/handlers/backup.ts`. */
function isRegularFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
  }
}

export interface AudioFootprint {
  /** How many recordings currently have a file on disk and have not yet been released. */
  recordings: number;
  bytes: number;
  /** The earliest moment any currently-held, transcribed recording becomes due for release, or
   * `null` when nothing qualifies -- because nothing is held, nothing has a transcript yet, or
   * the setting is `null` ("keep forever"), in which case nothing is ever due. Absolute, not
   * relative to `now`, so this needs no clock of its own. */
  nextReleaseAt: string | null;
}

/** Design §9.4: wherever the app reports on its own state, it also reports audio -- how many
 * recordings are held, how much space they take, and when the next release is due. Read by
 * `safetyStatus`, which extends the same status line Task 4 built the seam for. */
export function audioFootprint(db: DB): AudioFootprint {
  const windowDays = audioRetentionDays(db);
  const windowMs = windowDays === null ? null : windowDays * 24 * 60 * 60 * 1000;
  let recordings = 0;
  let bytes = 0;
  let nextDueMs: number | null = null;

  for (const item of allMeetingItems(db)) {
    const meta = parseMeta<MeetingMeta>(item);
    const recording = meta.recording;
    if (!recording?.wavPath || meta.audioReleasedAt) continue;
    const size = statSize(absoluteWavPath(recording.wavPath));
    if (size === null) continue; // meta says there was a file; there is not, so nothing is held
    recordings += 1;
    bytes += size;
    if (windowMs !== null && recording.endedAt && hasTranscript(item.extractedText)) {
      const dueAt = Date.parse(recording.endedAt) + windowMs;
      if (nextDueMs === null || dueAt < nextDueMs) nextDueMs = dueAt;
    }
  }

  return { recordings, bytes, nextReleaseAt: nextDueMs === null ? null : new Date(nextDueMs).toISOString() };
}
