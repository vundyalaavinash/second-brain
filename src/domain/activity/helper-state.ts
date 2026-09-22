import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { ActivityError } from "./rules";

export interface HelperState {
  lastSeen: string | null;
  version: string | null;
  permissions: { accessibility: boolean; calendar: boolean; automation: Record<string, boolean> } | null;
  /** How many event calendars the helper can see; null until it has reported. */
  calendarsSeen: number | null;
}

const CALENDARS_SEEN_KEY = "activity.helper.calendarsSeen";
const EMPTY: HelperState = { lastSeen: null, version: null, permissions: null, calendarsSeen: null };

function readCalendarsSeen(db: DB): number | null {
  const raw = getSetting(db, CALENDARS_SEEN_KEY, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function getHelperState(db: DB): HelperState {
  const calendarsSeen = readCalendarsSeen(db);
  try {
    const stored = JSON.parse(getSetting(db, "activity_helper_state", "{}")) as Partial<HelperState>;
    return { ...EMPTY, ...stored, calendarsSeen };
  } catch {
    return { ...EMPTY, calendarsSeen };
  }
}

export function recordHelperSeen(
  db: DB,
  at: string,
  helper?: { version?: string; permissions?: HelperState["permissions"]; calendarsSeen?: number },
): void {
  const prev = getHelperState(db);
  setSetting(
    db,
    "activity_helper_state",
    JSON.stringify({ lastSeen: at, version: helper?.version ?? prev.version, permissions: helper?.permissions ?? prev.permissions }),
  );
  if (helper?.calendarsSeen !== undefined) setSetting(db, CALENDARS_SEEN_KEY, String(helper.calendarsSeen));
}

export function isPaused(db: DB): boolean {
  return getSetting(db, "activity_paused", "0") === "1";
}

export function setPaused(db: DB, paused: boolean): void {
  setSetting(db, "activity_paused", paused ? "1" : "0");
}

export function retentionDays(db: DB): number {
  const n = Number(getSetting(db, "activity_retention_days", "90"));
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function setRetentionDays(db: DB, days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ActivityError("Retention must be between 1 and 3650 days");
  setSetting(db, "activity_retention_days", String(days));
}
