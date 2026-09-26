import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
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
  // `Number("")` is `0`, not NaN -- and `0` is the most aggressive value this setting has
  // ("release as soon as a transcript exists"), the opposite of what an unreadable value should
  // fall back to. A blank stored value must land on the safe default, never the destructive one.
  if (raw.trim() === "") return DEFAULT_AUDIO_RETENTION_DAYS;
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
 * transcript first landed, and proves nothing about what is on the item right now).
 *
 * Strips zero-width characters before the emptiness check: `String.prototype.trim()` already
 * treats ordinary whitespace, NBSP and the BOM as blank, but does not recognise the zero-width
 * space, zero-width non-joiner/joiner, or the word joiner as whitespace at all -- so a
 * "transcript" made of nothing but one of those would otherwise read as present. */
const ZERO_WIDTH_RE = /[​‌‍⁠]/g;

function hasTranscript(extractedText: string): boolean {
  return extractedText.replace(ZERO_WIDTH_RE, "").trim().length > 0;
}

function absoluteWavPath(wavPath: string): string {
  return path.join(filesDir(), wavPath);
}

const MEETINGS_DIR = () => path.resolve(filesDir(), "meetings");

/** `wavPath` resolved to an absolute path, but only when it stays inside `files/meetings` -- the
 * one directory this module is allowed to delete from. Nothing writes `meta.recording.wavPath`
 * today except `Recorder.start`, which always names it `meetings/<id>-<startedAt>.wav`, but a
 * deletion has no way to know that a given value actually came from there rather than, say,
 * `../attachments/x` -- so it checks, the same way `sweepSidecars` (`jobs/handlers/backup.ts`)
 * refuses to touch anything outside its own directory rather than trusting the name it was
 * given. `null` for anything that would resolve outside; callers treat that like "nothing to
 * delete" rather than deleting whatever the path actually points at. */
function containedWavPath(wavPath: string): string | null {
  const dir = MEETINGS_DIR();
  const resolved = path.resolve(filesDir(), wavPath);
  const withSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return resolved === dir || resolved.startsWith(withSep) ? resolved : null;
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
 * error; `null` for anything that was never eligible (no recording, already released, no
 * transcript, or a `wavPath` that does not resolve inside `files/meetings` -- see
 * `containedWavPath`), and the transcript itself is never touched either way.
 *
 * Deliberately does not consult `audioRetentionDays` or compare `recording.endedAt` against
 * `now` -- unlike `releasableRecordings`, which is the only thing that decides *when* a
 * recording becomes due. This function is the actual deletion primitive both the nightly pass
 * (only after `releasableRecordings` says a recording is due) and the "Remove the audio" action
 * (`DELETE /api/meetings/[id]/audio`, on demand, regardless of the window -- that is the whole
 * point of that action) call into. The rule that cannot be broken still holds unconditionally
 * either way. One consequence worth knowing: `now` only affects the stamp written to
 * `audioReleasedAt`, never whether the delete happens -- a caller with a rewound clock still
 * deletes the file, and the meeting rail would then render whatever backdated date `now` gave it.
 */
export function releaseAudio(db: DB, itemId: number, now: Date = new Date()): { freedBytes: number } | null {
  const item = getItem(db, itemId);
  if (!item) return null;
  const meta = parseMeta<MeetingMeta>(item);
  const recording = meta.recording;
  if (!recording?.wavPath || meta.audioReleasedAt) return null;
  if (!hasTranscript(item.extractedText)) return null; // the rule that cannot be broken, checked again, right here

  const absolute = containedWavPath(recording.wavPath);
  if (!absolute) {
    console.error(`[audio-retention] refusing to release item ${itemId}: wavPath "${recording.wavPath}" does not resolve inside files/meetings`);
    return null;
  }
  const freedBytes = statSizeOrZero(absolute);
  fs.rmSync(absolute, { force: true });
  mergeItemMeta(db, itemId, { audioReleasedAt: now.toISOString(), audioReleasedBytes: freedBytes });
  return { freedBytes };
}

/**
 * Reads `item.meta` as a plain object, or `null` when it cannot be trusted as one -- invalid
 * JSON, or JSON that parses fine but isn't an object at all (`null`, an array, a bare string or
 * number). `parseMeta` (`domain/items`) cannot make this distinction: it swallows every one of
 * those into `{}`, which is indistinguishable from a meeting whose meta genuinely has no
 * `recording` field. `sweepOrphanAudio` needs the distinction, because for it "cannot read this
 * item's meta" and "this item has no recording" lead to opposite answers about the same file.
 */
function readMeetingMeta(item: Item): MeetingMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.meta);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as MeetingMeta;
}

/** The item id a wav's own file name encodes, or `null` if it does not look like one.
 * `Recorder.start` (`recorder.ts`) always names a recording's file `<itemId>-<startedAt>.wav`,
 * so a candidate for deletion carries a second, independent way to ask "does a meeting still
 * care about this file" -- on top of, not instead of, the referenced-paths set built from every
 * item's own `meta.recording.wavPath`. */
function itemIdFromWavName(name: string): number | null {
  const m = /^(\d+)-/.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Deletes a `.wav` under `files/meetings` that no meeting item -- including an archived one --
 * currently points at: the orphan a deleted meeting leaves behind. One of only two things in
 * this whole design permitted to delete a file it did not write (`sweepSidecars` in
 * `jobs/handlers/backup.ts` is the other), so it builds the complete set of referenced paths from
 * every meeting item before deleting anything, the same shape `sweepSidecars` and `pruneBackups`
 * already use -- an earlier version of the sidecar sweep skipped exactly this step and destroyed
 * committed data in a reviewer's reproduction.
 *
 * **If any meeting item's meta cannot be read (`readMeetingMeta` returns `null`), the sweep
 * deletes nothing at all and says so.** A reviewer reproduced the alternative: an item with
 * unparseable meta contributes nothing to the referenced set, which is indistinguishable from
 * "no item points at this file", so its still-live, still-untranscribed recording was swept as
 * an orphan. A malformed row must never be read as "no row" -- the corrupt-meta state is exactly
 * the state this whole branch exists to survive, and an incomplete keep-set is not a keep-set.
 * The offending item's id is logged so it can be looked at, and nothing is deleted until it can.
 *
 * Every remaining candidate also gets a second, independent check the referenced-paths set alone
 * cannot provide: `itemIdFromWavName` reads the item id the file's own name encodes, and if that
 * item exists, is readable, and has no transcript yet, the file is refused regardless of what
 * `meta.recording.wavPath` says -- design §9.1's rule belongs to every deletion path here, not
 * only to `releaseAudio`, and this is what keeps that true even if a readable item's `wavPath`
 * field were ever stale or wrong.
 */
export function sweepOrphanAudio(db: DB): { files: number; bytes: number } {
  const dir = path.join(filesDir(), "meetings");
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };

  const referenced = new Set<string>();
  for (const item of allMeetingItems(db)) {
    const meta = readMeetingMeta(item);
    if (meta === null) {
      console.error(`[audio-retention] item ${item.id}'s meta could not be read; refusing to sweep any orphan audio until it is fixed`);
      return { files: 0, bytes: 0 }; // an incomplete keep-set is not a keep-set
    }
    const wavPath = meta.recording?.wavPath;
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
    const name = path.basename(abs);
    const ownerId = itemIdFromWavName(name);
    if (ownerId !== null) {
      const owner = getItem(db, ownerId);
      if (owner && owner.type === "meeting" && !hasTranscript(owner.extractedText)) {
        console.error(`[audio-retention] refusing to sweep ${name}: it names meeting item ${ownerId}, which has no transcript yet`);
        continue; // the rule that cannot be broken, for every deletion path in this module
      }
    }
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

const AUDIO_FOOTPRINT_SNAPSHOT_KEY = "meetings.audioFootprintSnapshot";

export interface AudioFootprintSnapshot extends AudioFootprint {
  /** When this snapshot was computed, so a caller that cares how fresh it is can check rather
   * than assume "just now" -- the status line does not currently show this, but the shape is
   * here so it could without another format change. */
  computedAt: string;
}

/**
 * Computes `audioFootprint` -- an O(number of meeting items ever created) scan -- once, and
 * persists the result, so `readAudioFootprintSnapshot`, which is what design §9.4's status line
 * actually reads on every page load, stays O(1) regardless of how many meetings exist. Measured:
 * `safetyStatus` calling `audioFootprint` directly cost 17.59 ms at three thousand meetings,
 * against the "cheap on every page load" a status read is supposed to be (`safety-status.ts`'s
 * own doc comment). Called by the nightly job right after its own release + sweep pass, by the
 * "Remove the audio" action, and by `release-audio.ts`'s manual run -- so the snapshot is never
 * older than whichever of those most recently touched the audio on disk, and at worst lags by
 * one nightly cycle for anything that only happens by itself (a new recording starting, say).
 */
export function recordAudioFootprint(db: DB, now: Date = new Date()): AudioFootprintSnapshot {
  const footprint = audioFootprint(db);
  const snapshot: AudioFootprintSnapshot = { ...footprint, computedAt: now.toISOString() };
  setSetting(db, AUDIO_FOOTPRINT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

/** The last snapshot `recordAudioFootprint` wrote -- an O(1) settings read, never a scan. All
 * zero and `nextReleaseAt: null` when nothing has been recorded yet (a fresh install, or before
 * the first nightly run has had a chance to): the same "silence is not evidence of a problem"
 * reading the rest of design §7 already gives an unset value, not a reason to fall back to the
 * O(n) scan this function exists specifically so the status line never has to run. */
export function readAudioFootprintSnapshot(db: DB): AudioFootprint {
  const raw = getSetting(db, AUDIO_FOOTPRINT_SNAPSHOT_KEY, "");
  if (!raw) return { recordings: 0, bytes: 0, nextReleaseAt: null };
  try {
    const parsed = JSON.parse(raw) as AudioFootprintSnapshot;
    return { recordings: parsed.recordings, bytes: parsed.bytes, nextReleaseAt: parsed.nextReleaseAt };
  } catch {
    return { recordings: 0, bytes: 0, nextReleaseAt: null };
  }
}
