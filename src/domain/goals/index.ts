import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, goalLinks, goals, tasks, type Goal } from "@/db/schema";
import type { ContainerKind, GoalHorizon, GoalStatus } from "@/db/enums";
import { addDays, dayBounds, localDay } from "@/domain/activity";
import { containerProgress } from "@/domain/tasks";
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

/** Plain goal rows, with no measure or links attached. Nothing in this app calls it yet — every
 * current caller wants `goalsWithMeasure` — but it is exported for later slices of this design
 * that only need the rows themselves, so it is kept rather than inlined into a private query. */
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
  const { status, ...fields } = patch;
  const set: Partial<typeof goals.$inferInsert> = {};
  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (!title) throw new GoalError("A goal needs a title");
    set.title = title;
  }
  if (fields.outcome !== undefined) set.outcome = fields.outcome.trim();
  if (fields.horizon !== undefined) set.horizon = fields.horizon;
  if (fields.targetDate !== undefined) {
    if (!DAY.test(fields.targetDate)) throw new GoalError("A goal needs a target date");
    set.targetDate = fields.targetDate;
  }
  if (fields.notes !== undefined) set.notes = fields.notes;
  if (fields.sortOrder !== undefined) set.sortOrder = fields.sortOrder;

  let row: Goal | undefined;
  if (Object.keys(set).length > 0) {
    row = db
      .update(goals)
      .set({ ...set, updatedAt: nowIso() })
      .where(eq(goals.id, id))
      .returning()
      .get();
    if (!row) throw new GoalError("Goal not found", 404);
  }
  // Status and closedAt move together, so a status change is always routed through closeGoal
  // or reopenGoal rather than written here directly: that is what stops a caller writing a
  // closed status with no closedAt, or a closedAt that survives a reopen.
  if (status !== undefined) row = status === "active" ? reopenGoal(db, id) : closeGoal(db, id, status);
  return row ?? requireGoal(db, id);
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

/**
 * Replaces the whole link set in one transaction. Both existence checks run inside it, on the
 * same snapshot as the writes: a container deleted between an outside check and the insert
 * would otherwise abort the transaction with a raw foreign-key error instead of this function's
 * own 400, for a race that is easy to hit and hard to tell apart from a bad request.
 */
export function setGoalLinks(db: DB, goalId: number, containerIds: number[]): void {
  const ids = [...new Set(containerIds)];
  db.transaction((tx) => {
    if (!tx.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId)).get()) throw new GoalError("Goal not found", 404);
    if (ids.length > 0) {
      const found = tx.select({ id: containers.id, kind: containers.kind }).from(containers).where(inArray(containers.id, ids)).all();
      if (found.length !== ids.length) throw new GoalError("A linked container does not exist");
      // Design §3.1: a goal links to projects and areas, never a resource. The UI only ever
      // offers the two, but the same query that already fetched `kind` can enforce it for API
      // callers too, rather than leaving it as surface only the client happens not to reach.
      if (found.some((c) => c.kind !== "project" && c.kind !== "area")) {
        throw new GoalError("A goal can only link to projects and areas");
      }
    }
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

/**
 * Every goal linking to this container, active by default — the same rule `goalRefsByContainer`
 * exists to enforce for task chips: a closed goal should not still badge the work it was closed
 * against. Pass `includeClosed: true` for a caller that genuinely wants the whole history (an
 * audit, "what did this container ever serve"), not as a default anything can reach by accident.
 */
export function goalsForContainer(db: DB, containerId: number, opts: { includeClosed?: boolean } = {}): Goal[] {
  const conds = [eq(goalLinks.containerId, containerId)];
  if (!opts.includeClosed) conds.push(eq(goals.status, "active"));
  return db
    .select({ goal: goals })
    .from(goalLinks)
    .innerJoin(goals, eq(goals.id, goalLinks.goalId))
    .where(and(...conds))
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
 * The counting half of the measure, shared with `goalsWithMeasure` so a link map it already has
 * to build for the `containers` field is not built a second time. Open and done counts come
 * from `containerProgress` — the same arithmetic `GET /api/goals/[id]` serves per link — summed
 * per goal over its linked container ids, so a goal's headline percent and its per-link percent
 * read the same numbers and can never drift apart. What is left is genuinely this module's own:
 * the movement window and the last close, from one query bounded to the stalled window (the
 * wider of the two), never a goal's whole close history.
 */
function measureFromLinks(db: DB, goalIds: number[], today: string, links: Map<number, ContainerRef[]>): Map<number, GoalMeasure> {
  const empty = (): GoalMeasure => ({ open: 0, done: 0, total: 0, percent: 0, movement: 0, lastClosedAt: null, stalled: true });
  const out = new Map<number, GoalMeasure>(goalIds.map((id) => [id, empty()]));
  if (goalIds.length === 0) return out;

  const containerIds = [...new Set([...links.values()].flatMap((refs) => refs.map((r) => r.id)))];
  const progress = containerProgress(db, containerIds);
  for (const [goalId, refs] of links) {
    const m = out.get(goalId);
    if (!m) continue;
    for (const ref of refs) {
      const p = progress.get(ref.id);
      if (!p) continue;
      m.open += p.open;
      m.done += p.done;
    }
  }

  // `completed_at` is a UTC instant; the windows are local days, so it is compared as a day.
  // Bounded to the stalled window in SQL: nothing closed before it can move `movement` or
  // change `stalled`, so the query never reads further back than the wider of the two windows.
  const since = addDays(today, -MOVEMENT_DAYS);
  const stalledSince = addDays(today, -STALLED_DAYS);
  const closes = db
    .select({ goalId: goalLinks.goalId, completedAt: tasks.completedAt })
    .from(goalLinks)
    .innerJoin(tasks, eq(tasks.containerId, goalLinks.containerId))
    .where(
      and(
        inArray(goalLinks.goalId, goalIds),
        eq(tasks.status, "done"),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, dayBounds(stalledSince).start),
      ),
    )
    .all();
  for (const row of closes) {
    const m = out.get(row.goalId);
    if (!m || !row.completedAt) continue;
    const day = localDay(row.completedAt);
    // Inclusive on both windows: a close exactly MOVEMENT_DAYS (or STALLED_DAYS) ago still
    // counts as motion, the same reading design §3.2 uses for "the last N days".
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

/** The measure for a caller that already has a goal id list and wants nothing else —
 * `goalsWithMeasure` is what every current call site uses, since it also needs the rows and the
 * links, but this stays exported for a later slice that measures a set of goals it already has
 * without re-listing them. */
export function measureGoals(db: DB, goalIds: number[], today: string): Map<number, GoalMeasure> {
  if (goalIds.length === 0) return new Map();
  return measureFromLinks(db, goalIds, today, goalLinksFor(db, goalIds));
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
  const links = goalLinksFor(db, ids);
  const measures = measureFromLinks(db, ids, today, links);
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
