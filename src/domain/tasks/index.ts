import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, items, tasks, type Task } from "@/db/schema";
import type { TaskPriority, TaskStatus } from "@/db/enums";
import { nowIso } from "@/lib/time";

export class TaskError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export interface Progress {
  open: number;
  done: number;
  total: number;
  percent: number;
  nextTask: { id: number; title: string; dueDate: string | null } | null;
}

export interface CreateTaskInput {
  title: string;
  containerId?: number | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  notes?: string;
  sourceItemId?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  containerId?: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new TaskError("Title is required");
  return t;
}

function checkDate(d: string | null | undefined): void {
  if (d != null && !DATE_RE.test(d)) throw new TaskError("Due date must be YYYY-MM-DD");
}

function requireContainer(db: DB, id: number): void {
  if (!db.select({ id: containers.id }).from(containers).where(eq(containers.id, id)).get()) throw new TaskError(`Container ${id} not found`, 404);
}

function requireItem(db: DB, id: number): void {
  if (!db.select({ id: items.id }).from(items).where(eq(items.id, id)).get()) throw new TaskError(`Item ${id} not found`, 404);
}

function containerWhere(containerId: number | null) {
  return containerId === null ? isNull(tasks.containerId) : eq(tasks.containerId, containerId);
}

function nextSortOrder(db: DB, containerId: number | null): number {
  const row = db
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(containerWhere(containerId))
    .get();
  return row?.max == null ? 0 : Number(row.max) + 1;
}

function requireTask(db: DB, id: number): Task {
  const row = getTask(db, id);
  if (!row) throw new TaskError(`Task ${id} not found`, 404);
  return row;
}

export function createTask(db: DB, input: CreateTaskInput): Task {
  const title = cleanTitle(input.title);
  checkDate(input.dueDate);
  const containerId = input.containerId ?? null;
  if (containerId !== null) requireContainer(db, containerId);
  const sourceItemId = input.sourceItemId ?? null;
  if (sourceItemId !== null) requireItem(db, sourceItemId);
  const now = nowIso();
  const row = db
    .insert(tasks)
    .values({
      title,
      notes: input.notes ?? "",
      priority: input.priority ?? "normal",
      dueDate: input.dueDate ?? null,
      containerId,
      sourceItemId,
      sortOrder: nextSortOrder(db, containerId),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function getTask(db: DB, id: number): Task | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

const STATUS_RANK = sql`case ${tasks.status} when 'open' then 0 when 'done' then 1 else 2 end`;

export function listTasks(db: DB, filter: { containerId?: number | null; status?: TaskStatus | "all" } = {}): Task[] {
  const conds = [];
  if (filter.containerId !== undefined) conds.push(containerWhere(filter.containerId));
  const status = filter.status ?? "open";
  if (status !== "all") conds.push(eq(tasks.status, status));
  return db
    .select()
    .from(tasks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(STATUS_RANK, asc(tasks.sortOrder), asc(tasks.id))
    .all();
}

export function updateTask(db: DB, id: number, patch: UpdateTaskInput): Task {
  const current = requireTask(db, id);
  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: nowIso() };
  if (patch.title !== undefined) set.title = cleanTitle(patch.title);
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.dueDate !== undefined) {
    checkDate(patch.dueDate);
    set.dueDate = patch.dueDate;
  }
  if (patch.containerId !== undefined && patch.containerId !== current.containerId) {
    if (patch.containerId !== null) requireContainer(db, patch.containerId);
    set.containerId = patch.containerId;
    set.sortOrder = nextSortOrder(db, patch.containerId);
  }
  const row = db.update(tasks).set(set).where(eq(tasks.id, id)).returning().get();
  if (!row) throw new TaskError(`Task ${id} not found`, 404);
  return row;
}

function setStatus(db: DB, id: number, status: TaskStatus): Task {
  requireTask(db, id);
  const now = nowIso();
  const row = db
    .update(tasks)
    .set({ status, completedAt: status === "done" ? now : null, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!row) throw new TaskError(`Task ${id} not found`, 404);
  return row;
}

export function completeTask(db: DB, id: number): Task {
  return setStatus(db, id, "done");
}

export function reopenTask(db: DB, id: number): Task {
  return setStatus(db, id, "open");
}

export function dropTask(db: DB, id: number): Task {
  return setStatus(db, id, "dropped");
}

export function deleteTask(db: DB, id: number): void {
  const res = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (res.changes === 0) throw new TaskError(`Task ${id} not found`, 404);
}

/** Listed ids take positions 0..n-1 in order; the container's other open tasks follow in their current order. */
export function reorderTasks(db: DB, containerId: number | null, ids: number[]): Task[] {
  const open = listTasks(db, { containerId, status: "open" });
  const byId = new Map(open.map((t) => [t.id, t]));
  const listed = ids.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  const listedIds = new Set(listed.map((t) => t.id));
  const ordered = [...listed, ...open.filter((t) => !listedIds.has(t.id))];
  const now = nowIso();
  db.transaction((tx) => {
    ordered.forEach((t, i) => tx.update(tasks).set({ sortOrder: i, updatedAt: now }).where(eq(tasks.id, t.id)).run());
  });
  return listTasks(db, { containerId, status: "open" });
}

function emptyProgress(): Progress {
  return { open: 0, done: 0, total: 0, percent: 0, nextTask: null };
}

/** Progress for many containers in two queries: counts grouped by container and status, then the first open task per container. */
export function containerProgress(db: DB, ids: number[]): Map<number, Progress> {
  const out = new Map<number, Progress>(ids.map((id) => [id, emptyProgress()]));
  if (ids.length === 0) return out;
  const counts = db
    .select({ containerId: tasks.containerId, status: tasks.status, c: sql<number>`count(*)` })
    .from(tasks)
    .where(and(inArray(tasks.containerId, ids), inArray(tasks.status, ["open", "done"])))
    .groupBy(tasks.containerId, tasks.status)
    .all();
  for (const row of counts) {
    if (row.containerId == null) continue;
    const p = out.get(row.containerId)!;
    if (row.status === "open") p.open = Number(row.c);
    else p.done = Number(row.c);
  }
  const openTasks = db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, containerId: tasks.containerId, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(and(inArray(tasks.containerId, ids), eq(tasks.status, "open")))
    .orderBy(asc(tasks.sortOrder), sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id))
    .all();
  for (const t of openTasks) {
    const p = out.get(t.containerId!)!;
    if (!p.nextTask) p.nextTask = { id: t.id, title: t.title, dueDate: t.dueDate };
  }
  for (const p of out.values()) {
    p.total = p.open + p.done;
    p.percent = p.total ? Math.round((p.done / p.total) * 100) : 0;
  }
  return out;
}

export function projectProgress(db: DB, containerId: number): Progress {
  return containerProgress(db, [containerId]).get(containerId) ?? emptyProgress();
}
