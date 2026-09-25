import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { TaskError } from "@/domain/tasks";
import { parseWorkHours } from "./capacity";

export const WORK_HOURS_KEY = "planner.workHours";
export const DEFAULT_WORK_HOURS = "09:00-18:00";

export function getWorkHours(db: DB): string {
  const value = getSetting(db, WORK_HOURS_KEY, DEFAULT_WORK_HOURS);
  return parseWorkHours(value) ? value : DEFAULT_WORK_HOURS;
}

/** The check `setWorkHours` throws on, extracted so the settings route can validate a whole
 * patch — every field, `workHours` included — before writing any of it (honest-forecast review
 * F2: a patch that fails on a later field must not have already saved an earlier one). */
export function assertValidWorkHours(value: string): void {
  if (!parseWorkHours(value)) throw new TaskError("Hours must be HH:MM-HH:MM with the start before the end", 400);
}

export function setWorkHours(db: DB, value: string): string {
  assertValidWorkHours(value);
  setSetting(db, WORK_HOURS_KEY, value);
  return value;
}

/** ISO weekday numbers (Monday 1 through Sunday 7), stored as a comma-separated list so the
 * setting stays a plain string like every other one in this table. */
export const WORKING_DAYS_KEY = "planner.workingDays";
/** Monday through Friday. */
export const DEFAULT_WORKING_DAYS = "1,2,3,4,5";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Deduplicated and sorted, the one shape both the write path and the read path answer in —
 * a stored value nobody wrote through `setWorkingDays` (a hand-edited row, an older format)
 * must not read back with duplicates just because the write path was the only place that
 * promised to remove them. */
function dedupeSorted(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

function parseWorkingDays(value: string): number[] | null {
  const days = value.split(",").map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return null;
  return dedupeSorted(days);
}

export function getWorkingDays(db: DB): number[] {
  const value = getSetting(db, WORKING_DAYS_KEY, DEFAULT_WORKING_DAYS);
  return parseWorkingDays(value) ?? parseWorkingDays(DEFAULT_WORKING_DAYS)!;
}

/** The check `setWorkingDays` throws on, extracted for the same reason `assertValidWorkHours`
 * is: so a caller validating a whole patch can check this field without writing it. */
export function assertValidWorkingDays(days: number[]): void {
  if (days.length === 0) throw new TaskError("Pick at least one working day", 400);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new TaskError("A working day is 1 (Monday) to 7 (Sunday)", 400);
}

export function setWorkingDays(db: DB, days: number[]): number[] {
  assertValidWorkingDays(days);
  const unique = dedupeSorted(days);
  setSetting(db, WORKING_DAYS_KEY, unique.join(","));
  return unique;
}

/**
 * Whether `date` (a bare `YYYY-MM-DD`) is one of `days`. Built from local date components via
 * the `Date(y, m, d)` constructor — never `new Date(date).getDay()`, which parses a bare date
 * as UTC midnight and reads a day out west of Greenwich. `Date`'s own `getDay()` is Sunday 0
 * through Saturday 6; ISO weekdays run Monday 1 through Sunday 7, so Sunday is remapped to 7.
 */
export function isWorkingDay(days: number[], date: string): boolean {
  if (!DAY_RE.test(date)) throw new TaskError("Day must be YYYY-MM-DD", 400);
  const [y, m, d] = date.split("-").map(Number);
  const sunday0 = new Date(y, m - 1, d).getDay();
  const isoWeekday = sunday0 === 0 ? 7 : sunday0;
  return days.includes(isoWeekday);
}
