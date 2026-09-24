import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, goalLinks, goals, tasks, type Goal } from "@/db/schema";
import type { ContainerKind, GoalHorizon, GoalStatus } from "@/db/enums";
import { addDays, localDay } from "@/domain/activity";
import { nowIso } from "@/lib/time";

/** Closes inside this many days are what "movement" counts. */
export const MOVEMENT_DAYS = 7;
/** A goal with nothing closed against it in this many days is stalled and says so. */
export const STALLED_DAYS = 14;

export class GoalError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "GoalError";
  }
}

export interface ContainerRef {
  id: number;
  name: string;
  slug: string;
  kind: ContainerKind;
}

export interface GoalMeasure {
  open: number;
  done: number;
  total: number;
  percent: number;
  /** Tasks closed against this goal inside the movement window. */
  movement: number;
  lastClosedAt: string | null;
  stalled: boolean;
}

export interface GoalWithMeasure extends Goal {
  measure: GoalMeasure;
  containers: ContainerRef[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function requireGoal(db: DB, id: number): Goal {
  const row = getGoal(db, id);
  if (!row) throw new GoalError("Goal not found", 404);
  return row;
}

export function createGoal(
  db: DB,
  input: { title: string; outcome?: string; horizon: GoalHorizon; targetDate: string; notes?: string },
): Goal {
  const title = input.title.trim();
  if (!title) throw new GoalError("A goal needs a title");
  if (!DAY.test(input.targetDate)) throw new GoalError("A goal needs a target date");
  const now = nowIso();
  const row = db
    .insert(goals)
    .values({
      title,
      outcome: input.outcome?.trim() ?? "",
      horizon: input.horizon,
      targetDate: input.targetDate,
      notes: input.notes ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function getGoal(db: DB, id: number): Goal | undefined {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export function listGoals(db: DB, filter: { status?: GoalStatus } = {}): Goal[] {
  return db
    .select()
    .from(goals)
    .where(filter.status ? eq(goals.status, filter.status) : undefined)
    .orderBy(asc(goals.targetDate), asc(goals.id))
    .all();
}

export function updateGoal(
  db: DB,
  id: number,
  patch: { title?: string; outcome?: string; horizon?: GoalHorizon; targetDate?: string; notes?: string; sortOrder?: number; status?: GoalStatus },
): Goal {
  requireGoal(db, id);
  const set: Partial<typeof goals.$inferInsert> = { updatedAt: nowIso() };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new GoalError("A goal needs a title");
    set.title = title;
  }
  if (patch.outcome !== undefined) set.outcome = patch.outcome.trim();
  if (patch.horizon !== undefined) set.horizon = patch.horizon;
  if (patch.targetDate !== undefined) {
    if (!DAY.test(patch.targetDate)) throw new GoalError("A goal needs a target date");
    set.targetDate = patch.targetDate;
  }
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (patch.status !== undefined) set.status = patch.status;
  const row = db.update(goals).set(set).where(eq(goals.id, id)).returning().get();
  if (!row) throw new GoalError("Goal not found", 404);
  return row;
}

/** Records the outcome and the time it closed. `reopenGoal` is the only way to clear both. */
export function closeGoal(db: DB, id: number, status: "hit" | "missed" | "dropped"): Goal {
  requireGoal(db, id);
  const row = db.update(goals).set({ status, closedAt: nowIso(), updatedAt: nowIso() }).where(eq(goals.id, id)).returning().get();
  if (!row) throw new GoalError("Goal not found", 404);
  return row;
}

export function reopenGoal(db: DB, id: number): Goal {
  requireGoal(db, id);
  const row = db.update(goals).set({ status: "active", closedAt: null, updatedAt: nowIso() }).where(eq(goals.id, id)).returning().get();
  if (!row) throw new GoalError("Goal not found", 404);
  return row;
}

export function deleteGoal(db: DB, id: number): void {
  const res = db.delete(goals).where(eq(goals.id, id)).run();
  if (res.changes === 0) throw new GoalError("Goal not found", 404);
}

/** Replaces the whole link set in one transaction, after checking every id exists. */
export function setGoalLinks(db: DB, goalId: number, containerIds: number[]): void {
  if (!getGoal(db, goalId)) throw new GoalError("Goal not found", 404);
  const ids = [...new Set(containerIds)];
  if (ids.length > 0) {
    const found = db.select({ id: containers.id }).from(containers).where(inArray(containers.id, ids)).all();
    if (found.length !== ids.length) throw new GoalError("A linked container does not exist");
  }
  db.transaction((tx) => {
    tx.delete(goalLinks).where(eq(goalLinks.goalId, goalId)).run();
    if (ids.length > 0) tx.insert(goalLinks).values(ids.map((containerId) => ({ goalId, containerId }))).run();
  });
}

/** Every listed goal's linked containers in one query, ordered by name. */
export function goalLinksFor(db: DB, goalIds: number[]): Map<number, ContainerRef[]> {
  const out = new Map<number, ContainerRef[]>(goalIds.map((id) => [id, []]));
  if (goalIds.length === 0) return out;
  const rows = db
    .select({ goalId: goalLinks.goalId, id: containers.id, name: containers.name, slug: containers.slug, kind: containers.kind })
    .from(goalLinks)
    .innerJoin(containers, eq(containers.id, goalLinks.containerId))
    .where(inArray(goalLinks.goalId, goalIds))
    .orderBy(asc(containers.name))
    .all();
  for (const row of rows) {
    out.get(row.goalId)?.push({ id: row.id, name: row.name, slug: row.slug, kind: row.kind });
  }
  return out;
}

export function goalsForContainer(db: DB, containerId: number): Goal[] {
  return db
    .select({ goal: goals })
    .from(goalLinks)
    .innerJoin(goals, eq(goals.id, goalLinks.goalId))
    .where(eq(goalLinks.containerId, containerId))
    .orderBy(asc(goals.targetDate), asc(goals.id))
    .all()
    .map((row) => row.goal);
}

/**
 * Per container id, the active goals it serves — this is what the task chips read, so a closed
 * goal must never appear here: nothing on a finished goal's project should still badge it.
 */
export function goalRefsByContainer(db: DB, containerIds: number[]): Map<number, { id: number; title: string }[]> {
  const out = new Map<number, { id: number; title: string }[]>(containerIds.map((id) => [id, []]));
  if (containerIds.length === 0) return out;
  const rows = db
    .select({ containerId: goalLinks.containerId, id: goals.id, title: goals.title })
    .from(goalLinks)
    .innerJoin(goals, eq(goals.id, goalLinks.goalId))
    .where(and(inArray(goalLinks.containerId, containerIds), eq(goals.status, "active")))
    .orderBy(asc(goals.targetDate), asc(goals.id))
    .all();
  for (const row of rows) {
    out.get(row.containerId)?.push({ id: row.id, title: row.title });
  }
  return out;
}

/**
 * The measure is two grouped queries plus the link rows already fetched elsewhere — never one
 * query per goal. One query counts open and done tasks per goal through the link table, a
 * second reads the closes inside the movement window and the newest close of all.
 */
export function measureGoals(db: DB, goalIds: number[], today: string): Map<number, GoalMeasure> {
  const empty = (): GoalMeasure => ({ open: 0, done: 0, total: 0, percent: 0, movement: 0, lastClosedAt: null, stalled: true });
  const out = new Map<number, GoalMeasure>(goalIds.map((id) => [id, empty()]));
  if (goalIds.length === 0) return out;

  const counts = db
    .select({ goalId: goalLinks.goalId, status: tasks.status, c: sql<number>`count(*)` })
    .from(goalLinks)
    .innerJoin(tasks, eq(tasks.containerId, goalLinks.containerId))
    .where(and(inArray(goalLinks.goalId, goalIds), inArray(tasks.status, ["open", "done"])))
    .groupBy(goalLinks.goalId, tasks.status)
    .all();
  for (const row of counts) {
    const m = out.get(row.goalId);
    if (!m) continue;
    if (row.status === "open") m.open = Number(row.c);
    else m.done = Number(row.c);
  }

  // `completed_at` is a UTC instant; the windows are local days, so it is compared as a day.
  const since = addDays(today, -MOVEMENT_DAYS);
  const stalledSince = addDays(today, -STALLED_DAYS);
  const closes = db
    .select({ goalId: goalLinks.goalId, completedAt: tasks.completedAt })
    .from(goalLinks)
    .innerJoin(tasks, eq(tasks.containerId, goalLinks.containerId))
    .where(and(inArray(goalLinks.goalId, goalIds), eq(tasks.status, "done"), isNotNull(tasks.completedAt)))
    .all();
  for (const row of closes) {
    const m = out.get(row.goalId);
    if (!m || !row.completedAt) continue;
    const day = localDay(row.completedAt);
    if (day >= since) m.movement += 1;
    if (m.lastClosedAt === null || row.completedAt > m.lastClosedAt) m.lastClosedAt = row.completedAt;
  }

  for (const m of out.values()) {
    m.total = m.open + m.done;
    m.percent = m.total ? Math.round((m.done / m.total) * 100) : 0;
    // No linked work at all is stalled by definition; so is work nothing has closed on lately.
    m.stalled = m.lastClosedAt === null || localDay(m.lastClosedAt) < stalledSince;
  }
  return out;
}

/**
 * Lists goals matching `filter`, orders active ones by nearest target date and closed ones by
 * most recently closed, and attaches each one's measure and linked containers.
 */
export function goalsWithMeasure(db: DB, filter: { status?: GoalStatus; id?: number } = {}, today: string): GoalWithMeasure[] {
  const conds = [];
  if (filter.status !== undefined) conds.push(eq(goals.status, filter.status));
  if (filter.id !== undefined) conds.push(eq(goals.id, filter.id));
  const rows = db
    .select()
    .from(goals)
    .where(conds.length ? and(...conds) : undefined)
    // Active and closed goals answer different questions, so each keeps its own clock: an
    // active list reads soonest-due-first, a closed one reads most-recently-decided-first.
    // The case expressions null out the other group's key, so within each partition only its
    // own columns break ties — a mixed, unfiltered list still sorts each half correctly.
    .orderBy(
      sql`case when ${goals.status} = 'active' then 0 else 1 end`,
      sql`case when ${goals.status} = 'active' then ${goals.targetDate} end`,
      sql`case when ${goals.status} = 'active' then ${goals.id} end`,
      desc(sql`case when ${goals.status} != 'active' then ${goals.closedAt} end`),
    )
    .all();
  const ids = rows.map((r) => r.id);
  const measures = measureGoals(db, ids, today);
  const links = goalLinksFor(db, ids);
  return rows.map((row) => ({ ...row, measure: measures.get(row.id)!, containers: links.get(row.id) ?? [] }));
}

/** The goal's most recently closed tasks, across every container it is linked to. */
export function recentCloses(db: DB, goalId: number, limit: number): { id: number; title: string; completedAt: string; containerName: string }[] {
  const rows = db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt, containerName: containers.name })
    .from(goalLinks)
    .innerJoin(tasks, eq(tasks.containerId, goalLinks.containerId))
    .innerJoin(containers, eq(containers.id, goalLinks.containerId))
    .where(and(eq(goalLinks.goalId, goalId), eq(tasks.status, "done"), isNotNull(tasks.completedAt)))
    .orderBy(desc(tasks.completedAt))
    .limit(limit)
    .all();
  return rows.map((r) => ({ id: r.id, title: r.title, completedAt: r.completedAt!, containerName: r.containerName }));
}
