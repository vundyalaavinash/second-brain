import { and, asc, eq, isNull, ne, sql, count } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, items, tasks, type Container, type ContainerKind, type ContainerStatus, type ResourceCategory } from "@/db/schema";
import { nowIso } from "@/lib/time";

export class ContainerError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ContainerError";
  }
}

export interface CreateContainerInput {
  kind: ContainerKind;
  name: string;
  description?: string;
  goal?: string;
  deadline?: string | null;
  standard?: string;
  category?: ResourceCategory | null;
}

export interface UpdateContainerInput {
  name?: string;
  description?: string;
  goal?: string;
  deadline?: string | null;
  standard?: string;
  category?: ResourceCategory | null;
  sortOrder?: number;
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "container";
}

function uniqueSlug(db: DB, name: string, excludeId?: number): string {
  const base = slugify(name);
  let candidate = base;
  for (let n = 2; ; n++) {
    const existing = db.select({ id: containers.id }).from(containers).where(eq(containers.slug, candidate)).get();
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n}`;
  }
}

function requireContainer(db: DB, id: number): Container {
  const c = getContainer(db, id);
  if (!c) throw new ContainerError(`Container ${id} not found`, 404);
  return c;
}

export function createContainer(db: DB, input: CreateContainerInput): Container {
  const now = nowIso();
  const name = input.name.trim();
  if (!name) throw new ContainerError("Name is required");
  const row = db
    .insert(containers)
    .values({
      kind: input.kind,
      name,
      slug: uniqueSlug(db, name),
      description: input.description ?? "",
      goal: input.goal ?? "",
      deadline: input.deadline ?? null,
      standard: input.standard ?? "",
      category: input.kind === "resource" ? (input.category ?? "other") : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function getContainer(db: DB, id: number): Container | undefined {
  return db.select().from(containers).where(eq(containers.id, id)).get();
}

export function getContainerBySlug(db: DB, slug: string): Container | undefined {
  return db.select().from(containers).where(eq(containers.slug, slug)).get();
}

export function listContainers(db: DB, filter: { kind?: ContainerKind; status?: ContainerStatus } = {}): Container[] {
  const conds = [];
  if (filter.kind) conds.push(eq(containers.kind, filter.kind));
  if (filter.status) conds.push(eq(containers.status, filter.status));
  const order =
    filter.kind === "project"
      ? [sql`${containers.deadline} IS NULL`, asc(containers.deadline), asc(containers.sortOrder), asc(containers.name)]
      : [asc(containers.kind), asc(containers.sortOrder), asc(containers.name)];
  return db
    .select()
    .from(containers)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...order)
    .all();
}

export function updateContainer(db: DB, id: number, patch: UpdateContainerInput): Container {
  const current = requireContainer(db, id);
  const set: Partial<typeof containers.$inferInsert> = { updatedAt: nowIso() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ContainerError("Name is required");
    set.name = name;
    if (name !== current.name) set.slug = uniqueSlug(db, name, id);
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.goal !== undefined) set.goal = patch.goal;
  if (patch.deadline !== undefined) set.deadline = patch.deadline;
  if (patch.standard !== undefined) set.standard = patch.standard;
  if (patch.category !== undefined) set.category = current.kind === "resource" ? patch.category : null;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  const row = db.update(containers).set(set).where(eq(containers.id, id)).returning().get();
  if (!row) throw new ContainerError(`Container ${id} not found`, 404);
  return row;
}

export function countContainerItems(db: DB, id: number, includeArchived = false): number {
  const conds = [eq(items.containerId, id)];
  if (!includeArchived) conds.push(isNull(items.archivedAt));
  const row = db.select({ c: count() }).from(items).where(and(...conds)).get();
  return row?.c ?? 0;
}

/**
 * Archive a container. Without moveItemsTo its active items are archived with it.
 * With moveItemsTo (a container id, or null for the Inbox) its items are re-homed and stay active.
 */
export function archiveContainer(db: DB, id: number, opts: { moveItemsTo?: number | null } = {}): Container {
  requireContainer(db, id);
  if (opts.moveItemsTo === id) throw new ContainerError("A container cannot be moved into itself");
  if (typeof opts.moveItemsTo === "number") requireContainer(db, opts.moveItemsTo);
  const now = nowIso();
  return db.transaction((tx) => {
    if (opts.moveItemsTo !== undefined) {
      tx.update(items)
        .set({ containerId: opts.moveItemsTo, updatedAt: now })
        .where(and(eq(items.containerId, id), isNull(items.archivedAt)))
        .run();
    } else {
      tx.update(items)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(items.containerId, id), isNull(items.archivedAt)))
        .run();
    }
    const openTasks = tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.containerId, id), eq(tasks.status, "open")))
      .orderBy(asc(tasks.sortOrder))
      .all();
    if (opts.moveItemsTo === undefined) {
      // The bulk drop bypasses `setStatus` (this is many tasks in one statement, not the
      // single-task funnel), so it has to stamp `droppedAt` itself — a review of the week a
      // project was archived would otherwise never see the tasks it took down with it.
      tx.update(tasks)
        .set({ status: "dropped", droppedAt: now, updatedAt: now })
        .where(and(eq(tasks.containerId, id), eq(tasks.status, "open")))
        .run();
    } else {
      const target = opts.moveItemsTo;
      const base = tx
        .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
        .from(tasks)
        .where(target === null ? isNull(tasks.containerId) : eq(tasks.containerId, target))
        .get();
      let order = base?.max == null ? 0 : Number(base.max) + 1;
      for (const t of openTasks) tx.update(tasks).set({ containerId: target, sortOrder: order++, updatedAt: now }).where(eq(tasks.id, t.id)).run();
    }
    const row = tx
      .update(containers)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(eq(containers.id, id))
      .returning()
      .get();
    if (!row) throw new ContainerError(`Container ${id} not found`, 404);
    return row;
  });
}

/**
 * Restore a container and the items/tasks that were archived or dropped along with it — not ones
 * a user archived or dropped by hand while the container was still active. `archiveContainer`
 * stamps the container, its items, and its dropped tasks with the same timestamp, so only rows
 * sharing that timestamp qualify.
 */
export function restoreContainer(db: DB, id: number): Container {
  const container = requireContainer(db, id);
  const now = nowIso();
  return db.transaction((tx) => {
    if (container.archivedAt) {
      tx.update(items)
        .set({ archivedAt: null, updatedAt: now })
        .where(and(eq(items.containerId, id), eq(items.archivedAt, container.archivedAt)))
        .run();
      tx.update(tasks)
        .set({ status: "open", droppedAt: null, updatedAt: now })
        .where(and(eq(tasks.containerId, id), eq(tasks.status, "dropped"), eq(tasks.droppedAt, container.archivedAt)))
        .run();
    }
    const row = tx
      .update(containers)
      .set({ status: "active", archivedAt: null, updatedAt: now })
      .where(eq(containers.id, id))
      .returning()
      .get();
    if (!row) throw new ContainerError(`Container ${id} not found`, 404);
    return row;
  });
}

export function deleteContainer(db: DB, id: number): void {
  requireContainer(db, id);
  if (countContainerItems(db, id, true) > 0) {
    throw new ContainerError("Container still has items; move or archive them first", 409);
  }
  const activeTask = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.containerId, id), ne(tasks.status, "dropped")))
    .get();
  if (activeTask) {
    throw new ContainerError("Move or finish its tasks first", 409);
  }
  db.delete(containers).where(eq(containers.id, id)).run();
}
