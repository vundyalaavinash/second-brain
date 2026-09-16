import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { ActivityError } from "./rules";

export interface HelperState {
  lastSeen: string | null;
  version: string | null;
  permissions: { accessibility: boolean; calendar: boolean; automation: Record<string, boolean> } | null;
}

const EMPTY: HelperState = { lastSeen: null, version: null, permissions: null };

export function getHelperState(db: DB): HelperState {
  try {
    return { ...EMPTY, ...(JSON.parse(getSetting(db, "activity_helper_state", "{}")) as Partial<HelperState>) };
  } catch {
    return EMPTY;
  }
}

export function recordHelperSeen(db: DB, at: string, helper?: { version: string; permissions: HelperState["permissions"] }): void {
  const prev = getHelperState(db);
  setSetting(
    db,
    "activity_helper_state",
    JSON.stringify({ lastSeen: at, version: helper?.version ?? prev.version, permissions: helper?.permissions ?? prev.permissions }),
  );
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
