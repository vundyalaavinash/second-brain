import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
import { createItem, getItem, parseMeta, updateItem } from "@/domain/items";
import { captureMeeting } from "@/domain/activity/calendar";
import { filesDir } from "@/lib/paths";
import { MeetingError } from "./errors";
import { Recorder, type RecorderStatus } from "./recorder";
import { checkTools } from "./tools";

export { MeetingError } from "./errors";
export { Recorder } from "./recorder";
export type { RecorderStatus, RecorderState, RecordingMeta } from "./recorder";
export { mergeTranscript, LiveTranscriber } from "./live";
export type { LiveSegment } from "./live";

/** Where the Record buttons and the chip target a session. */
export interface RecordingTarget {
  calendarEventId?: number;
  itemId?: number;
  adhoc?: boolean;
}

/**
 * One controller per process: the machine has one set of microphones. It hangs off
 * `globalThis`, not a module variable, because Next bundles `instrumentation.ts` and the
 * route handlers into separate module graphs: a module-local singleton would give the
 * auto-start scheduler and `/api/meetings/recorder/*` a controller each, so an auto-started
 * session would be invisible to the chip and a manual Record could spawn a second helper.
 * Same trick as `__sbWorker` in `src/server/boot.ts` and `__sbDb` in `src/db/client.ts`.
 */
const g = globalThis as unknown as { __sbRecorder?: Recorder | null };

/** Swap the controller in (tests, and the scheduler that owns auto-start). Pass null to clear. */
export function setRecorder(recorder: Recorder | null): void {
  g.__sbRecorder = recorder;
}

export function getRecorder(db: DB): Recorder {
  if (g.__sbRecorder) return g.__sbRecorder;
  const tools = checkTools(db);
  if (!tools.recorder) {
    throw new MeetingError(`Recording needs ${tools.missing.join(", ")}. Run the setup script and try again`, 503);
  }
  g.__sbRecorder = new Recorder({
    db,
    recorderBin: tools.recorder,
    whisperBin: tools.whisper,
    baseModel: tools.baseModel,
    filesDir: filesDir(),
  });
  return g.__sbRecorder;
}

/** The status without building a controller: nothing is recording until something has started. */
export function recorderStatus(): RecorderStatus {
  return g.__sbRecorder ? g.__sbRecorder.status() : { state: "idle" };
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** A meeting to hang an unplanned recording on, named for the minute it started. */
export function createAdhocMeeting(db: DB, now: Date = new Date()): Item {
  return createItem(db, {
    type: "meeting",
    title: `Meeting at ${two(now.getHours())}:${two(now.getMinutes())}`,
    status: "processing",
    meta: { adhoc: true },
  });
}

function resolveTarget(db: DB, target: RecordingTarget): Item {
  if (target.calendarEventId !== undefined) return captureMeeting(db, target.calendarEventId);
  if (target.itemId !== undefined) {
    const item = getItem(db, target.itemId);
    if (!item) throw new MeetingError(`Item ${target.itemId} not found`, 404);
    if (item.type !== "meeting") throw new MeetingError("Only a meeting can be recorded", 400);
    return item;
  }
  if (target.adhoc) return createAdhocMeeting(db);
  throw new MeetingError("Give a calendar event, a meeting item, or adhoc", 400);
}

/**
 * Recording a meeting that already has a transcript files the old one away first.
 *
 * Recording again is allowed -- a meeting resumes, or someone hits stop by mistake -- but the
 * final pass overwrites `transcript` wholesale when it lands, so without this the earlier
 * transcript (and the live pass beside it) would be gone with no warning and no way back: the
 * audio it came from is on a retention timer and may already have been released. Each prior
 * session keeps its own transcript, live pass and wav path, oldest first.
 */
function archivePreviousSession(db: DB, item: Item): void {
  const meta = parseMeta<{
    transcript?: unknown;
    liveTranscript?: unknown;
    recording?: { wavPath?: string; startedAt?: string };
    previousSessions?: unknown[];
  }>(item);
  if (!meta.transcript && !meta.liveTranscript) return;
  const previousSessions = [
    ...(Array.isArray(meta.previousSessions) ? meta.previousSessions : []),
    {
      startedAt: meta.recording?.startedAt ?? null,
      wavPath: meta.recording?.wavPath ?? null,
      transcript: meta.transcript ?? null,
      liveTranscript: meta.liveTranscript ?? null,
    },
  ];
  const next = { ...meta, previousSessions } as Record<string, unknown>;
  delete next.transcript;
  delete next.liveTranscript;
  delete next.final_transcript_ready;
  delete next.summary;
  updateItem(db, item.id, { meta: next });
}

export function startRecording(db: DB, target: RecordingTarget, opts: { autoStarted?: boolean } = {}): RecorderStatus {
  const recorder = getRecorder(db);
  if (recorder.status().state === "recording" || recorder.status().state === "stopping") {
    throw new MeetingError("A recording is already running", 409);
  }
  const resolved = resolveTarget(db, target);
  archivePreviousSession(db, resolved);
  // Re-read: `Recorder.start` spreads the meta off the item it is handed, so passing the copy
  // taken before archiving would write the old transcript straight back over the archive.
  const item = getItem(db, resolved.id) ?? resolved;
  recorder.start(item, opts);
  return recorder.status();
}

export async function stopRecording(): Promise<RecorderStatus> {
  const recorder = g.__sbRecorder;
  if (!recorder) return { state: "idle" };
  return recorder.stop();
}

/** Ruling: the chip's "Keep recording" and the auto-stop rule share this flag. */
export function keepRecording(): RecorderStatus {
  const recorder = g.__sbRecorder;
  if (!recorder) return { state: "idle" };
  return recorder.keep();
}
