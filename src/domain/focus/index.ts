import { and, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { focusRuns, tasks, type FocusRun } from "@/db/schema";
import type { FocusOutcome } from "@/db/enums";
import { getTask } from "@/domain/tasks";
import { getSetting, setSetting } from "@/domain/settings";
import { dayBounds, localDay } from "@/domain/activity";
import { getDay, topApps } from "@/domain/activity/report";

export class FocusError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "FocusError";
  }
}

/** A run ended inside this many minutes of its start is a mis-click, not work: it is abandoned
 * whatever it was called, and books nothing. */
export const ABANDON_UNDER = 2;
/** A live run left open past its planned end by more than this many minutes is a browser closed
 * mid-run, not work still going; it is reconciled closed at the end it was meant to have. */
export const STALE_AFTER = 30;
/** How many apps or sites `focusWhere` names. */
const FOCUS_WHERE_LIMIT = 3;

const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

export interface FocusSettings {
  defaultMinutes: number;
  shortBreak: number;
  longBreak: number;
  longBreakEvery: number;
}

const DEFAULT_MINUTES_KEY = "focus.defaultMinutes";
const SHORT_BREAK_KEY = "focus.shortBreak";
const LONG_BREAK_KEY = "focus.longBreak";
const LONG_BREAK_EVERY_KEY = "focus.longBreakEvery";

const FOCUS_SETTINGS_DEFAULTS: FocusSettings = { defaultMinutes: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };

export function getFocusSettings(db: DB): FocusSettings {
  return {
    defaultMinutes: Number(getSetting(db, DEFAULT_MINUTES_KEY, String(FOCUS_SETTINGS_DEFAULTS.defaultMinutes))),
    shortBreak: Number(getSetting(db, SHORT_BREAK_KEY, String(FOCUS_SETTINGS_DEFAULTS.shortBreak))),
    longBreak: Number(getSetting(db, LONG_BREAK_KEY, String(FOCUS_SETTINGS_DEFAULTS.longBreak))),
    longBreakEvery: Number(getSetting(db, LONG_BREAK_EVERY_KEY, String(FOCUS_SETTINGS_DEFAULTS.longBreakEvery))),
  };
}

/** Writes the keys the patch carries and returns all four, which is what the route answers with. */
export function setFocusSettings(db: DB, patch: Partial<FocusSettings>): FocusSettings {
  if (patch.defaultMinutes !== undefined) setSetting(db, DEFAULT_MINUTES_KEY, String(patch.defaultMinutes));
  if (patch.shortBreak !== undefined) setSetting(db, SHORT_BREAK_KEY, String(patch.shortBreak));
  if (patch.longBreak !== undefined) setSetting(db, LONG_BREAK_KEY, String(patch.longBreak));
  if (patch.longBreakEvery !== undefined) setSetting(db, LONG_BREAK_EVERY_KEY, String(patch.longBreakEvery));
  return getFocusSettings(db);
}

/** Anything with `select`/`update`/`insert`/`delete` — `db` itself, or the `tx` handle inside a
 * transaction. Drizzle's transaction handle is not a `DB` (it carries no `$client`), so the row
 * helpers below take this instead and work identically either way. */
type Executor = Pick<DB, "select" | "update" | "insert" | "delete">;

function liveRow(db: Executor): FocusRun | undefined {
  return db.select().from(focusRuns).where(isNull(focusRuns.endedAt)).get();
}

/**
 * Closes a run, applying the one rule that must never be sprinkled across callers: under
 * `ABANDON_UNDER` minutes is a mis-click, not work, and is abandoned whatever it was called,
 * booking nothing — so a day's figure is never inflated by a run nobody actually sat through.
 */
function closeRow(db: Executor, run: FocusRun, outcome: FocusOutcome, now: Date): FocusRun {
  const ran = Math.max(0, Math.round((now.getTime() - Date.parse(run.startedAt)) / 60_000));
  const settled: FocusOutcome = ran < ABANDON_UNDER || outcome === "abandoned" ? "abandoned" : outcome;
  const row = db
    .update(focusRuns)
    .set({ endedAt: now.toISOString(), actualMinutes: settled === "abandoned" ? 0 : ran, outcome: settled })
    .where(eq(focusRuns.id, run.id))
    .returning()
    .get();
  if (!row) throw new FocusError("Focus run not found", 404);
  return row;
}

/** Starts a run on a task, in the minutes given or the default length. Starting stops whatever
 * run is currently live, in the same transaction: there is only ever one run at a time, and the
 * incumbent keeps whatever it has actually run rather than losing it to a race. */
export function startFocus(db: DB, input: { taskId: number; blockId?: number | null; minutes?: number }, now = new Date()): FocusRun {
  if (!getTask(db, input.taskId)) throw new FocusError("Task not found", 404);
  const minutes = input.minutes ?? getFocusSettings(db).defaultMinutes;
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw new FocusError(`A run is ${MIN_MINUTES} to ${MAX_MINUTES} minutes`);
  }
  return db.transaction((tx) => {
    const live = liveRow(tx);
    if (live) closeRow(tx, live, "stopped", now);
    const row = tx
      .insert(focusRuns)
      .values({ taskId: input.taskId, blockId: input.blockId ?? null, startedAt: now.toISOString(), plannedMinutes: minutes })
      .returning()
      .get();
    if (!row) throw new Error("Insert returned no row");
    return row;
  });
}

/** Finishes a live run with the outcome the caller names — `closeRow` may still override it to
 * "abandoned" when too little time passed for it to count as anything else. */
export function finishFocus(db: DB, id: number, outcome: FocusOutcome, now = new Date()): FocusRun {
  const row = db.select().from(focusRuns).where(eq(focusRuns.id, id)).get();
  if (!row) throw new FocusError("Focus run not found", 404);
  if (row.endedAt !== null) throw new FocusError("Focus run already finished");
  return closeRow(db, row, outcome, now);
}

/**
 * The live run, if there is one. A browser closed mid-run leaves the row open forever, so this
 * reconciles first: past the grace period the run is closed at the end it was meant to have, not
 * at `now` — crediting hours nobody worked would make every figure that reads this a lie.
 */
export function runningFocus(db: DB, now = new Date()): FocusRun | null {
  const live = liveRow(db);
  if (!live) return null;
  const plannedEnd = Date.parse(live.startedAt) + live.plannedMinutes * 60_000;
  if (now.getTime() - plannedEnd > STALE_AFTER * 60_000) {
    closeRow(db, live, "completed", new Date(plannedEnd));
    return null;
  }
  return live;
}

/** Minutes actually run, per task, for runs that booked anything at all — an abandoned run is
 * never in this map, not even at zero. */
export function focusMinutesByTask(db: DB, taskIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (taskIds.length === 0) return out;
  const rows = db
    .select({ taskId: focusRuns.taskId, minutes: focusRuns.actualMinutes })
    .from(focusRuns)
    .where(and(inArray(focusRuns.taskId, taskIds), isNotNull(focusRuns.actualMinutes), ne(focusRuns.outcome, "abandoned")))
    .all();
  for (const row of rows) out.set(row.taskId, (out.get(row.taskId) ?? 0) + (row.minutes ?? 0));
  return out;
}

export interface FocusSummary {
  minutes: number;
  runs: number;
  byTask: { taskId: number; title: string; minutes: number; runs: number }[];
}

/**
 * Booked minutes over `[from, to)`, both local days, by the day a run *started* — a run is work
 * done then, not work discovered now, so a run that crossed into `to` while it was running still
 * counts against the day it began. Reconciles a stale live run first, the same as `runningFocus`,
 * so a summary read right after a browser closed mid-run is not missing what it actually did.
 */
export function focusSummary(db: DB, range: { from: string; to: string }, now = new Date()): FocusSummary {
  runningFocus(db, now);
  const rows = db
    .select({ taskId: focusRuns.taskId, title: tasks.title, startedAt: focusRuns.startedAt, minutes: focusRuns.actualMinutes })
    .from(focusRuns)
    .innerJoin(tasks, eq(tasks.id, focusRuns.taskId))
    .where(and(gte(focusRuns.startedAt, dayBounds(range.from).start), isNotNull(focusRuns.actualMinutes), ne(focusRuns.outcome, "abandoned")))
    .all()
    .filter((row) => {
      const day = localDay(row.startedAt);
      return day >= range.from && day < range.to;
    });

  const byTask = new Map<number, { taskId: number; title: string; minutes: number; runs: number }>();
  let minutes = 0;
  let runs = 0;
  for (const row of rows) {
    const m = row.minutes ?? 0;
    minutes += m;
    runs += 1;
    const entry = byTask.get(row.taskId) ?? { taskId: row.taskId, title: row.title, minutes: 0, runs: 0 };
    entry.minutes += m;
    entry.runs += 1;
    byTask.set(row.taskId, entry);
  }
  return { minutes, runs, byTask: [...byTask.values()].sort((a, b) => b.minutes - a.minutes || a.taskId - b.taskId) };
}

/** How many runs finished "completed" on that local day, by when they started — what the
 * long-break rule counts against. */
export function completedToday(db: DB, date: string): number {
  const rows = db
    .select({ startedAt: focusRuns.startedAt })
    .from(focusRuns)
    .where(and(gte(focusRuns.startedAt, dayBounds(date).start), eq(focusRuns.outcome, "completed")))
    .all();
  return rows.filter((r) => localDay(r.startedAt) === date).length;
}

/**
 * Where the machine actually was while the run was live: the day's non-AFK sessions, clipped to
 * the run's own window and ranked by `topApps` — the same "name a browser by its busiest domain"
 * rule `activityToday` (src/lib/home.ts) uses, shared from `@/domain/activity` so there is only
 * one copy of it. Empty when the helper never reported anything for the run's window, and for a
 * run with no end yet.
 */
export function focusWhere(db: DB, run: FocusRun): { label: string; ms: number }[] {
  if (!run.endedAt) return [];
  const runStart = Date.parse(run.startedAt);
  const runEnd = Date.parse(run.endedAt);
  const day = getDay(db, localDay(run.startedAt));
  const overlapping = day.sessions
    .filter((s) => !s.afk)
    .map((s) => {
      const start = Math.max(runStart, Date.parse(s.startedAt));
      const end = Math.min(runEnd, Date.parse(s.endedAt));
      return { appId: s.appId, appName: s.appName, domain: s.domain, ms: end - start };
    })
    .filter((s) => s.ms > 0);
  return topApps(overlapping, FOCUS_WHERE_LIMIT);
}
