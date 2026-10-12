import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { FocusError, getFocusSettings } from "./index";

/**
 * The break between pomodoros, held in the database rather than in a component.
 *
 * It used to be a `useState` countdown inside the break offer, which meant walking to another page
 * cancelled it silently -- the timer went with the unmounted component, and nothing anywhere knew
 * a break had been taken. A break is singular, like the recorder: one at a time, or none. So it is
 * one stored instant rather than a table, and there is deliberately no history. What a break was
 * for is already answered by the focus runs either side of it.
 */
const BREAK_ENDS_AT_KEY = "focus.breakEndsAt";
const BREAK_MINUTES_KEY = "focus.breakMinutes";

/** Matches the bounds `setFocusSettings` enforces on the configured break lengths. */
const MIN_BREAK_MINUTES = 1;
const MAX_BREAK_MINUTES = 60;

export interface BreakState {
  /** When the running break ends, or null when none is running. */
  endsAt: string | null;
  remainingMs: number;
  /** What the running break was started for, so a pane can say "5 minute break" not just a clock. */
  minutes: number;
}

const NONE: BreakState = { endsAt: null, remainingMs: 0, minutes: 0 };

/**
 * How long the next break should be, given how many pomodoros are already done today: the long one
 * every `longBreakEvery`, the short one otherwise.
 *
 * This lived in the break-offer component, where the pomodoro pane could not reach it and nothing
 * tested it. Zero completed is not a multiple of anything -- the first break of the day is short.
 */
export function nextBreakMinutes(db: DB, completedToday: number): number {
  const settings = getFocusSettings(db);
  const isLong = completedToday > 0 && completedToday % settings.longBreakEvery === 0;
  return isLong ? settings.longBreak : settings.shortBreak;
}

/**
 * The running break, or `NONE`. A break whose time is up reads as no break rather than a negative
 * countdown, so nothing has to remember to clear it -- the stored instant simply stops mattering.
 * An unparseable stored value reads the same way: a pane asking for this must not be taken down,
 * and nobody should be stranded in a break that cannot end.
 */
export function breakState(db: DB, now: Date = new Date()): BreakState {
  const raw = getSetting(db, BREAK_ENDS_AT_KEY, "");
  if (!raw) return NONE;
  const endsAt = new Date(raw);
  if (Number.isNaN(endsAt.getTime())) return NONE;
  const remainingMs = endsAt.getTime() - now.getTime();
  if (remainingMs <= 0) return NONE;
  const minutes = Number(getSetting(db, BREAK_MINUTES_KEY, "0"));
  return { endsAt: endsAt.toISOString(), remainingMs, minutes: Number.isFinite(minutes) ? minutes : 0 };
}

/** Start a break of `minutes`, replacing any already running -- there is only ever one. */
export function startBreak(db: DB, minutes: number, now: Date = new Date()): BreakState {
  if (!Number.isInteger(minutes) || minutes < MIN_BREAK_MINUTES || minutes > MAX_BREAK_MINUTES) {
    throw new FocusError(`A break is ${MIN_BREAK_MINUTES} to ${MAX_BREAK_MINUTES} minutes`, 400);
  }
  setSetting(db, BREAK_ENDS_AT_KEY, new Date(now.getTime() + minutes * 60_000).toISOString());
  setSetting(db, BREAK_MINUTES_KEY, String(minutes));
  return breakState(db, now);
}

/** End the break now -- taken as "back to work", not as an error. */
export function endBreak(db: DB): BreakState {
  setSetting(db, BREAK_ENDS_AT_KEY, "");
  setSetting(db, BREAK_MINUTES_KEY, "0");
  return NONE;
}
