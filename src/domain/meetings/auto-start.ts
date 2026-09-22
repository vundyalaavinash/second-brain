import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calendarEvents, type CalendarEvent } from "@/db/schema";
import { listMeetings, localDay } from "@/domain/activity/calendar";
import { getItem, parseMeta } from "@/domain/items";
import { getSetting, setSetting } from "@/domain/settings";
import type { RecorderStatus, RecordingMeta } from "./recorder";
import { recorderStatus, startRecording, stopRecording } from "./index";

/** How late a meeting can be joined and still be picked up, and how early the rule may jump in. */
const LATE_MS = 2 * 60_000;
const EARLY_MS = 60_000;
/** The tail a meeting gets before an auto-started session is stopped. */
export const AUTO_STOP_GRACE_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const AUTO_RECORD_KEY = "meetings.autoRecord";
const NEEDS_CALL_LINK_KEY = "meetings.autoRecordNeedsCallLink";

export interface AutoRecordSettings {
  /** Off until someone turns it on: nothing records itself by surprise. */
  autoRecord: boolean;
  /** On by default, so a desk conversation in the diary is not recorded. */
  autoRecordNeedsCallLink: boolean;
}

export function getAutoRecordSettings(db: DB): AutoRecordSettings {
  return {
    autoRecord: getSetting(db, AUTO_RECORD_KEY, "0") === "1",
    autoRecordNeedsCallLink: getSetting(db, NEEDS_CALL_LINK_KEY, "1") === "1",
  };
}

/** Writes the keys the patch carries and returns both, which is what the route answers with. */
export function setAutoRecordSettings(db: DB, patch: Partial<AutoRecordSettings>): AutoRecordSettings {
  if (patch.autoRecord !== undefined) setSetting(db, AUTO_RECORD_KEY, patch.autoRecord ? "1" : "0");
  if (patch.autoRecordNeedsCallLink !== undefined) setSetting(db, NEEDS_CALL_LINK_KEY, patch.autoRecordNeedsCallLink ? "1" : "0");
  return getAutoRecordSettings(db);
}

/** True once a session has been hung on the event's item: a meeting is recorded once. */
function alreadyRecorded(db: DB, ev: CalendarEvent): boolean {
  if (!ev.itemId) return false;
  const item = getItem(db, ev.itemId);
  if (!item) return false;
  return !!parseMeta<{ recording?: RecordingMeta }>(item).recording;
}

/**
 * The meeting the rule would start recording at `now`, or null. Only a meeting that is
 * starting counts — two minutes late through one minute early — and it must be one the
 * person would record by hand: not declined, not an all-day block, not marked no-record,
 * not already recorded, and, while the call-link rule is on, one with somewhere to join.
 */
export function pickAutoStart(db: DB, now: Date, settings: AutoRecordSettings): CalendarEvent | null {
  if (!settings.autoRecord) return null;
  const earliest = now.getTime() - LATE_MS;
  const latest = now.getTime() + EARLY_MS;
  // The window can straddle local midnight, so ask for both days; `to` is exclusive.
  const from = localDay(new Date(earliest).toISOString());
  const to = localDay(new Date(latest + DAY_MS).toISOString());
  for (const ev of listMeetings(db, { from, to })) {
    const start = Date.parse(ev.startsAt);
    if (start < earliest || start > latest) continue;
    if (ev.allDay || ev.noRecord || ev.status === "declined") continue;
    if (settings.autoRecordNeedsCallLink && !ev.joinUrl) continue;
    if (alreadyRecorded(db, ev)) continue;
    return ev;
  }
  return null;
}

/**
 * Whether the running session has outstayed its meeting. Only a session the rule started is
 * ever stopped for someone, and only while nobody has said to keep it; the status carries no
 * end time, so the meeting is found back through the item it is recording into.
 */
export function autoStopDue(status: RecorderStatus, db: DB, now: Date): boolean {
  if (status.state !== "recording" || !status.autoStarted || status.keep) return false;
  if (status.itemId === undefined) return false;
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.itemId, status.itemId)).get();
  if (!ev) return false;
  return now.getTime() > Date.parse(ev.endsAt) + AUTO_STOP_GRACE_MS;
}

/**
 * One pass of the scheduler: stop a session that has outstayed its meeting, or start the one
 * that is beginning. A live session is the only thing that matters while it runs, so nothing
 * else is considered until it ends. Nothing here throws: an interval has nobody to catch it.
 */
export async function autoStartTick(db: DB, deps: { now?: () => Date; log?: (message: string) => void } = {}): Promise<void> {
  const now = deps.now?.() ?? new Date();
  try {
    const status = recorderStatus();
    if (status.state === "recording" || status.state === "stopping") {
      if (autoStopDue(status, db, now)) {
        deps.log?.(`stopping "${status.title ?? "recording"}": the meeting ended more than five minutes ago`);
        await stopRecording();
      }
      return;
    }
    const ev = pickAutoStart(db, now, getAutoRecordSettings(db));
    if (!ev) return;
    // A failed session is only a message on the chip; clearing it is what lets the next one start.
    if (status.state === "error") await stopRecording();
    startRecording(db, { calendarEventId: ev.id }, { autoStarted: true });
    deps.log?.(`recording "${ev.title}"`);
  } catch (err) {
    deps.log?.(`could not run: ${err instanceof Error ? err.message : String(err)}`);
  }
}
