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

export function setWorkHours(db: DB, value: string): string {
  if (!parseWorkHours(value)) throw new TaskError("Hours must be HH:MM-HH:MM with the start before the end", 400);
  setSetting(db, WORK_HOURS_KEY, value);
  return value;
}
