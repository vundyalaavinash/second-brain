import { and, asc, eq, inArray, like } from "drizzle-orm";
import type { DB } from "@/db/client";
import { dailyPlanEntries, taskBlocks, tasks, type Task, type TaskBlock } from "@/db/schema";
import { addDays, listMeetings } from "@/domain/activity";
import { getTask, updateTask } from "@/domain/tasks";
import { freeSlots, placeSessions, sessionsFor, type Span } from "@/lib/scheduler";
import { getWorkHours } from "@/lib/work-hours";

export class BlockError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "BlockError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TS = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;
/** The estimate's own ceiling: a sum of sessions past it never writes a length the task refuses. */
const MAX_ESTIMATE = 480;

function checkStartsAt(v: string): void {
  if (!LOCAL_TS.test(v) || Number.isNaN(Date.parse(v))) throw new BlockError("A session start is YYYY-MM-DDTHH:MM:SS in local time", 400);
}

function checkMinutes(n: number): void {
  if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES) throw new BlockError(`A session is between ${MIN_MINUTES} and ${MAX_MINUTES} minutes`, 400);
}

function checkDate(date: string): void {
  if (!DATE_RE.test(date)) throw new BlockError("A date is YYYY-MM-DD", 400);
}

function requireTask(db: DB, id: number): Task {
  const row = getTask(db, id);
  if (!row) throw new BlockError(`Task ${id} not found`, 404);
  return row;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day a timestamp falls on. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * A local timestamp for `minutesOfDay` on `date`. The domain keeps its own copy rather than
 * reaching into the timeline's math: the same clock rules, no dependency on a component.
 */
function minutesToIso(date: string, minutesOfDay: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(y, m - 1, d, 0, minutesOfDay, 0, 0);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
}

/** Minutes from local midnight of `date` to the timestamp; a span from another day reads past the ends. */
function minutesInto(date: string, iso: string): number {
  return Math.round((new Date(iso).getTime() - new Date(`${date}T00:00:00`).getTime()) / 60_000);
}

/** The local day of `now`, the one a placement must not put sessions before. */
function localToday(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function listBlocks(db: DB, filter: { taskId?: number; date?: string } = {}): TaskBlock[] {
  const conds = [];
  if (filter.taskId !== undefined) conds.push(eq(taskBlocks.taskId, filter.taskId));
  if (filter.date !== undefined) conds.push(like(taskBlocks.startsAt, `${filter.date}%`));
  return db
    .select()
    .from(taskBlocks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(taskBlocks.startsAt), asc(taskBlocks.id))
    .all();
}

/** Every listed task's sessions in one query, each list ordered by start. */
export function blocksByTask(db: DB, taskIds: number[]): Map<number, TaskBlock[]> {
  const out = new Map<number, TaskBlock[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return out;
  const rows = db
    .select()
    .from(taskBlocks)
    .where(inArray(taskBlocks.taskId, taskIds))
    .orderBy(asc(taskBlocks.startsAt), asc(taskBlocks.id))
    .all();
  for (const row of rows) out.get(row.taskId)?.push(row);
  return out;
}

export function getBlock(db: DB, id: number): TaskBlock | undefined {
  return db.select().from(taskBlocks).where(eq(taskBlocks.id, id)).get();
}

export function addBlock(db: DB, input: { taskId: number; startsAt: string; minutes: number }): TaskBlock {
  requireTask(db, input.taskId);
  checkStartsAt(input.startsAt);
  checkMinutes(input.minutes);
  const row = db.insert(taskBlocks).values({ taskId: input.taskId, startsAt: input.startsAt, minutes: input.minutes }).returning().get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

/**
 * The estimate is the total, so it may not sit under the day's sessions: a session resized past
 * it pulls it up to their sum. An estimate nobody has guessed stays unguessed.
 */
function growEstimate(db: DB, taskId: number, date: string): void {
  const task = getTask(db, taskId);
  if (!task || task.estimateMinutes === null) return;
  const sum = listBlocks(db, { taskId, date }).reduce((n, b) => n + b.minutes, 0);
  if (sum > task.estimateMinutes) updateTask(db, taskId, { estimateMinutes: Math.min(MAX_ESTIMATE, sum) });
}

export function updateBlock(db: DB, id: number, patch: { startsAt?: string; minutes?: number }): TaskBlock {
  const current = getBlock(db, id);
  if (!current) throw new BlockError(`Session ${id} not found`, 404);
  const set: Partial<typeof taskBlocks.$inferInsert> = {};
  if (patch.startsAt !== undefined) {
    checkStartsAt(patch.startsAt);
    set.startsAt = patch.startsAt;
  }
  if (patch.minutes !== undefined) {
    checkMinutes(patch.minutes);
    set.minutes = patch.minutes;
  }
  const row = Object.keys(set).length ? db.update(taskBlocks).set(set).where(eq(taskBlocks.id, id)).returning().get() : current;
  if (!row) throw new BlockError(`Session ${id} not found`, 404);
  growEstimate(db, row.taskId, dayOf(row.startsAt));
  return row;
}

export function removeBlock(db: DB, id: number): void {
  const res = db.delete(taskBlocks).where(eq(taskBlocks.id, id)).run();
  if (res.changes === 0) throw new BlockError(`Session ${id} not found`, 404);
}

/** Takes the task's sessions off one day, or off every day when no date is given; returns how many went. */
export function clearBlocks(db: DB, taskId: number, date?: string): number {
  const where = date === undefined ? eq(taskBlocks.taskId, taskId) : and(eq(taskBlocks.taskId, taskId), like(taskBlocks.startsAt, `${date}%`));
  return db.delete(taskBlocks).where(where).run().changes;
}

/** What the day is already spoken for: timed meetings a person has not declined, and every session on it. */
function busySpans(db: DB, date: string): Span[] {
  const meetings = listMeetings(db, { from: date, to: addDays(date, 1) })
    .filter((m) => m.allDay === 0 && m.status !== "declined")
    .map((m) => ({ start: minutesInto(date, m.startsAt), end: minutesInto(date, m.endsAt) }));
  const blocks = listBlocks(db, { date }).map((b) => ({ start: minutesInto(date, b.startsAt), end: minutesInto(date, b.startsAt) + b.minutes }));
  return [...meetings, ...blocks];
}

/** One task's placement, without a transaction of its own: `placeTask` and `fillDay` own that. */
function place(db: DB, task: Task, date: string, now: Date, workHours: string): { placed: number; unplacedMinutes: number } {
  clearBlocks(db, task.id, date);
  const notBefore = date === localToday(now) ? now.getHours() * 60 + now.getMinutes() : undefined;
  const slots = freeSlots(busySpans(db, date), workHours, { notBefore });
  const { placed, leftover } = placeSessions(slots, sessionsFor(task.estimateMinutes, task.sessionMinutes), {});
  for (const span of placed) {
    db.insert(taskBlocks).values({ taskId: task.id, startsAt: minutesToIso(date, span.start), minutes: span.end - span.start }).run();
  }
  return { placed: placed.length, unplacedMinutes: leftover };
}

/**
 * Lays the task's sessions into the day's free slots, dropping whatever it held there before.
 * Sessions on other days are none of this day's business and stay where they are.
 */
export function placeTask(db: DB, opts: { taskId: number; date: string; now?: Date }): { placed: number; unplacedMinutes: number } {
  const task = requireTask(db, opts.taskId);
  checkDate(opts.date);
  const workHours = getWorkHours(db);
  const now = opts.now ?? new Date();
  return db.transaction(() => place(db, task, opts.date, now, workHours));
}

/** The day's open plan tasks that hold no session on it yet, in plan order. */
function toFill(db: DB, date: string): Task[] {
  const blocked = new Set(listBlocks(db, { date }).map((b) => b.taskId));
  return db
    .select({ task: tasks })
    .from(dailyPlanEntries)
    .innerJoin(tasks, eq(tasks.id, dailyPlanEntries.taskId))
    .where(and(eq(dailyPlanEntries.date, date), eq(tasks.status, "open")))
    .orderBy(asc(dailyPlanEntries.sortOrder), asc(dailyPlanEntries.id))
    .all()
    .map((row) => row.task)
    .filter((t) => !blocked.has(t.id));
}

/** Places every open plan task that has no session on the day yet, in plan order. */
export function fillDay(db: DB, opts: { date: string; now?: Date }): { placed: number; unplacedMinutes: number } {
  checkDate(opts.date);
  const workHours = getWorkHours(db);
  const now = opts.now ?? new Date();
  return db.transaction(() => {
    let placed = 0;
    let unplacedMinutes = 0;
    for (const task of toFill(db, opts.date)) {
      const one = place(db, task, opts.date, now, workHours);
      placed += one.placed;
      unplacedMinutes += one.unplacedMinutes;
    }
    return { placed, unplacedMinutes };
  });
}
