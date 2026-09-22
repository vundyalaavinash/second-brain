import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
import { createItem, getItem } from "@/domain/items";
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

/** One controller per process: the machine has one set of microphones. */
let singleton: Recorder | null = null;

/** Swap the controller in (tests, and the scheduler that owns auto-start). Pass null to clear. */
export function setRecorder(recorder: Recorder | null): void {
  singleton = recorder;
}

export function getRecorder(db: DB): Recorder {
  if (singleton) return singleton;
  const tools = checkTools(db);
  if (!tools.recorder) {
    throw new MeetingError(`Recording needs ${tools.missing.join(", ")}. Run the setup script and try again`, 503);
  }
  singleton = new Recorder({
    db,
    recorderBin: tools.recorder,
    whisperBin: tools.whisper,
    baseModel: tools.baseModel,
    filesDir: filesDir(),
  });
  return singleton;
}

/** The status without building a controller: nothing is recording until something has started. */
export function recorderStatus(): RecorderStatus {
  return singleton ? singleton.status() : { state: "idle" };
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

export function startRecording(db: DB, target: RecordingTarget, opts: { autoStarted?: boolean } = {}): RecorderStatus {
  const recorder = getRecorder(db);
  if (recorder.status().state === "recording" || recorder.status().state === "stopping") {
    throw new MeetingError("A recording is already running", 409);
  }
  const item = resolveTarget(db, target);
  recorder.start(item, opts);
  return recorder.status();
}

export async function stopRecording(): Promise<RecorderStatus> {
  if (!singleton) return { state: "idle" };
  return singleton.stop();
}

/** Ruling: the chip's "Keep recording" and the auto-stop rule share this flag. */
export function keepRecording(): RecorderStatus {
  if (!singleton) return { state: "idle" };
  return singleton.keep();
}
