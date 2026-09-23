import { and, asc, eq, like, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { dailyPlanEntries, tasks, type Task } from "@/db/schema";
import { getTask, TaskError } from "@/domain/tasks";
import { nowIso } from "@/lib/time";

/** A task as it sits on one day's plan: the task's own row, with the plan entry's id and the
 * plan's order rather than the task's order inside its container. */
export type PlanTask = Task & { planId: number; sortOrder: number };

function entryId(db: DB, date: string, taskId: number): number | undefined {
  return db
    .select({ id: dailyPlanEntries.id })
    .from(dailyPlanEntries)
    .where(and(eq(dailyPlanEntries.date, date), eq(dailyPlanEntries.taskId, taskId)))
    .get()?.id;
}

function nextSortOrder(db: DB, date: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${dailyPlanEntries.sortOrder})` })
    .from(dailyPlanEntries)
    .where(eq(dailyPlanEntries.date, date))
    .get();
  return row?.max == null ? 0 : Number(row.max) + 1;
}

export function listPlan(db: DB, date: string): PlanTask[] {
  return db
    .select({ task: tasks, planId: dailyPlanEntries.id, sortOrder: dailyPlanEntries.sortOrder })
    .from(dailyPlanEntries)
    .innerJoin(tasks, eq(tasks.id, dailyPlanEntries.taskId))
    .where(eq(dailyPlanEntries.date, date))
    .orderBy(asc(dailyPlanEntries.sortOrder), asc(dailyPlanEntries.id))
    .all()
    .map((row) => ({ ...row.task, planId: row.planId, sortOrder: row.sortOrder }));
}

/** Appends the task at the end of that day's plan. Planning it twice is not an error and does
 * not move it: the unique index on date+task is the plan's identity, not a clash to report. */
export function addToPlan(db: DB, date: string, taskId: number): void {
  if (!getTask(db, taskId)) throw new TaskError(`Task ${taskId} not found`, 404);
  if (entryId(db, date, taskId) !== undefined) return;
  db.insert(dailyPlanEntries).values({ date, taskId, sortOrder: nextSortOrder(db, date), createdAt: nowIso() }).run();
}

/** Takes the task off that day's plan and off the timeline with it: a task holds one block, and
 * that block belonged to the plan it is leaving. Only a block on `date` goes: the same task can
 * sit on several days, and leaving Monday must not take the hour it holds on Tuesday. A task
 * that was never on the plan is a no-op, so an undo can be replayed safely. */
export function removeFromPlan(db: DB, date: string, taskId: number): void {
  const removed = db.delete(dailyPlanEntries).where(and(eq(dailyPlanEntries.date, date), eq(dailyPlanEntries.taskId, taskId))).run().changes;
  if (removed > 0) db.update(tasks).set({ scheduledAt: null, updatedAt: nowIso() }).where(and(eq(tasks.id, taskId), like(tasks.scheduledAt, `${date}%`))).run();
}

/** Listed ids take positions 0..n-1 in order; the day's other entries follow in their current order. */
export function reorderPlan(db: DB, date: string, taskIds: number[]): PlanTask[] {
  const current = listPlan(db, date);
  const byId = new Map(current.map((t) => [t.id, t]));
  const listed = taskIds.map((id) => byId.get(id)).filter((t): t is PlanTask => !!t);
  const listedIds = new Set(listed.map((t) => t.id));
  const ordered = [...listed, ...current.filter((t) => !listedIds.has(t.id))];
  db.transaction((tx) => {
    ordered.forEach((t, i) => tx.update(dailyPlanEntries).set({ sortOrder: i }).where(eq(dailyPlanEntries.id, t.planId)).run());
  });
  return listPlan(db, date);
}

/** The still-open tasks on that day's plan, in plan order. Done and dropped tasks are finished
 * with, so neither carries over. */
export function unfinished(db: DB, date: string): Task[] {
  return listPlan(db, date).filter((t) => t.status === "open");
}

/** Adds every unfinished task of `from` to `to`, returning how many landed there. A task already
 * on `to` is left where it is and is not counted. A carried task loses the block it held on
 * `from`: it was placed on the day it is leaving, and the new day has its own hours. A block on
 * any other day is none of this day's business and stays where it is. */
export function carryOver(db: DB, from: string, to: string): number {
  let moved = 0;
  // The reads and the inserts share the connection the transaction opened, so `db` here is
  // already inside it; drizzle's `tx` handle is not a `DB` and could not be passed on.
  db.transaction(() => {
    for (const task of unfinished(db, from)) {
      if (entryId(db, to, task.id) !== undefined) continue;
      addToPlan(db, to, task.id);
      db.update(tasks).set({ scheduledAt: null, updatedAt: nowIso() }).where(and(eq(tasks.id, task.id), like(tasks.scheduledAt, `${from}%`))).run();
      moved += 1;
    }
  });
  return moved;
}

/** Blocked tasks first in clock order; the rest keep their order after them. */
export function sortPlanByTime(db: DB, date: string): PlanTask[] {
  const current = listPlan(db, date);
  const blocked = current.filter((t) => t.scheduledAt?.startsWith(date)).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const rest = current.filter((t) => !t.scheduledAt?.startsWith(date));
  return reorderPlan(db, date, [...blocked, ...rest].map((t) => t.id));
}
