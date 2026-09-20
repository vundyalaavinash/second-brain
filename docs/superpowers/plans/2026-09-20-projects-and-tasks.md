# Projects and Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the task model (tasks filed to projects and areas, with due dates, priority, manual order, done state, and progress) and redesign the project list into progress cards and the project page into an outcome hero, task list, notes, and items.

**Architecture:** A `tasks` table and `src/domain/tasks/` own creation, ordering, status, progress, and a pure quick-parse for the add row; `/api/tasks` exposes them; `ContainerDTO` carries `progress` so lists and heroes need no extra request. A one-time boot migration turns the old next-steps checklist into tasks. The UI adds a `ProgressRing`, `ProjectCard`s on `/projects`, and a `TaskList` used by project and area pages; the project page gains a hero band.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, better-sqlite3 + Drizzle (drizzle-kit migrations), zod 4, Vitest 5 (node for domain and API, jsdom with the line-1 pragma for components; `vitest.setup.ts` already polyfills ProseMirror needs), lucide-react, the primitives in `src/components/ui.tsx`, `RichEditor` from `src/components/editor/rich-editor.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-20-projects-and-tasks-design.md` (binding). Inherits `2026-09-12-second-brain-design.md`.

## Global Constraints

- Timestamps are ISO-8601 UTC strings from `nowIso()`; dates are `YYYY-MM-DD` strings validated by `DateString` in `src/lib/validation.ts`.
- Every table goes through `src/db/schema.ts` plus a drizzle-kit migration (`npm run db:generate -- --name <name>`); verify `ON DELETE SET NULL` on both task foreign keys in the generated SQL and hand-patch if missing.
- API routes follow `src/app/api/people/route.ts`: `export const dynamic = "force-dynamic"`, zod `safeParse` then 400, `parseId`, `errorResponse` (which must map `TaskError`).
- Dropped tasks are excluded from every count and from `nextTask`; `percent = total ? Math.round(done / total * 100) : 0`.
- Behaviour freeze on the container editor's existing save flow: `save`, the `latest` ref, ⌘S, `archiveOrRestore`, `remove`, `confirmDelete`, the Complete dialog's four archive calls, and every `aria-label`, `title`, and `disabled` condition stay as they are; this plan only moves the goal, deadline, and Complete button into the hero, removes the next-steps editor, and adds sections.
- Copy rules: sentence case; no uppercase tracked labels; no middle-dot strings ("8 tasks, 14 items"); buttons name the action; mono only for counts, dates, percent, ids.
- Every interactive element has a visible focus state (`focus-ring` primitives); no `outline-none` without one.
- Commit trailer lines on every commit (shown in each commit step). `npm test && npm run lint && npm run build` pristine at the end of every task. Do not start a server on port 3141.

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/enums.ts`, `src/db/schema.ts`, `drizzle/0005_*.sql` | task enums, table, types |
| `src/domain/tasks/index.ts` | CRUD, status changes, reorder, progress, `TaskError` |
| `src/domain/tasks/quick-parse.ts` | pure `quickParse(title, now?)` |
| `src/domain/tasks/migrate-next-steps.ts` | one-time migration of `next_steps` |
| `src/domain/containers/index.ts` | `archiveContainer` also relocates or drops tasks; `nextSteps` no longer accepted |
| `src/server/boot.ts` | runs the migration once |
| `src/lib/dto.ts`, `src/lib/api.ts`, `src/lib/validation.ts` | `TaskDTO`, `ProgressDTO`, `ContainerDTO.progress`, `serializeTask`, `errorResponse`, bodies |
| `src/app/api/tasks/route.ts`, `[id]/route.ts`, `reorder/route.ts` | routes |
| `src/lib/deadline.ts` | `deadlineLabel`, `sortProjects` (pure, tested) |
| `src/components/tasks/progress-ring.tsx` | SVG ring |
| `src/components/tasks/project-card.tsx` | card |
| `src/components/tasks/task-list.tsx`, `task-row.tsx` | the task list |
| `src/app/projects/page.tsx`, `src/components/new-container-form.tsx` | list page and form copy |
| `src/components/container-editor.tsx` | hero, tasks section, next-steps removal |
| `README.md` | Tasks paragraph |

---

### Task 1: Schema, domain, quick-parse, next-steps migration

**Files:**
- Modify: `src/db/enums.ts`, `src/db/schema.ts`
- Create: `drizzle/0005_tasks.sql` (generated; number may differ, keep what drizzle-kit produces), `src/domain/tasks/index.ts`, `src/domain/tasks/quick-parse.ts`, `src/domain/tasks/migrate-next-steps.ts`
- Test: `src/domain/tasks/index.test.ts`, `src/domain/tasks/quick-parse.test.ts`, `src/domain/tasks/migrate-next-steps.test.ts`

**Interfaces:**
- Produces:
  - `TASK_STATUSES = ["open", "done", "dropped"]`, `TASK_PRIORITIES = ["low", "normal", "high"]`, types `TaskStatus`, `TaskPriority`; table `tasks`, type `Task`.
  - `class TaskError extends Error { status }`
  - `interface Progress { open: number; done: number; total: number; percent: number; nextTask: { id: number; title: string; dueDate: string | null } | null }`
  - `createTask(db, input: { title: string; containerId?: number | null; dueDate?: string | null; priority?: TaskPriority; notes?: string; sourceItemId?: number | null }): Task`
  - `getTask(db, id): Task | undefined`
  - `listTasks(db, filter: { containerId?: number | null; status?: TaskStatus | "all" }): Task[]`
  - `updateTask(db, id, patch: { title?: string; notes?: string; priority?: TaskPriority; dueDate?: string | null; containerId?: number | null }): Task`
  - `completeTask(db, id)`, `reopenTask(db, id)`, `dropTask(db, id)`: `Task`; `deleteTask(db, id): void`
  - `reorderTasks(db, containerId: number | null, ids: number[]): Task[]`
  - `projectProgress(db, containerId: number): Progress`, `containerProgress(db, ids: number[]): Map<number, Progress>`
  - `quickParse(input: string, now?: Date): { title: string; priority: "high" | "normal"; dueDate: string | null }`
  - `migrateNextSteps(db): { containers: number; tasks: number }` (no-op after the first run)

- [ ] **Step 1: Enums and schema**

Append to `src/db/enums.ts`:

```ts
export const TASK_STATUSES = ["open", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
```

Append to `src/db/schema.ts` (import `TASK_STATUSES`, `TASK_PRIORITIES` from `./enums`):

```ts
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("normal"),
    dueDate: text("due_date"),
    containerId: integer("container_id").references(() => containers.id, { onDelete: "set null" }),
    sourceItemId: integer("source_item_id").references(() => items.id, { onDelete: "set null" }),
    recurrence: text("recurrence"),
    completedAt: text("completed_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("tasks_container_status_order_idx").on(t.containerId, t.status, t.sortOrder), index("tasks_status_due_idx").on(t.status, t.dueDate)],
);
export type Task = typeof tasks.$inferSelect;
```

Run `npm run db:generate -- --name tasks`; open the SQL and confirm both `ON DELETE set null` clauses; patch by hand if absent.

- [ ] **Step 2: Failing quick-parse test**

```ts
// src/domain/tasks/quick-parse.test.ts
import { describe, it, expect } from "vitest";
import { quickParse } from "./quick-parse";

const now = new Date(2026, 8, 16, 10, 0, 0); // Wednesday 16 September 2026, local

describe("quickParse", () => {
  it("returns the title untouched when nothing matches", () => {
    expect(quickParse("Draft welcome email", now)).toEqual({ title: "Draft welcome email", priority: "normal", dueDate: null });
  });
  it("reads a leading or trailing ! as high priority", () => {
    expect(quickParse("! Call the bank", now)).toEqual({ title: "Call the bank", priority: "high", dueDate: null });
    expect(quickParse("Call the bank!", now)).toEqual({ title: "Call the bank", priority: "high", dueDate: null });
  });
  it("reads today, tomorrow, weekday names, and ISO dates as the due date", () => {
    expect(quickParse("Pay rent today", now).dueDate).toBe("2026-09-16");
    expect(quickParse("Pay rent tomorrow", now).dueDate).toBe("2026-09-17");
    expect(quickParse("Ship it fri", now)).toEqual({ title: "Ship it", priority: "normal", dueDate: "2026-09-18" });
    expect(quickParse("Ship it Wednesday", now).dueDate).toBe("2026-09-16");
    expect(quickParse("Ship it tue", now).dueDate).toBe("2026-09-22");
    expect(quickParse("Ship it 2026-10-01", now)).toEqual({ title: "Ship it", priority: "normal", dueDate: "2026-10-01" });
  });
  it("combines priority and date and trims whitespace", () => {
    expect(quickParse("  Collect 1099 forms fri !  ", now)).toEqual({ title: "Collect 1099 forms", priority: "high", dueDate: "2026-09-18" });
  });
  it("does not eat a word that only looks like a day", () => {
    expect(quickParse("Read Monday's notes", now)).toEqual({ title: "Read Monday's notes", priority: "normal", dueDate: null });
    expect(quickParse("fri", now)).toEqual({ title: "fri", priority: "normal", dueDate: null });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/domain/tasks/quick-parse.test.ts`
Expected: FAIL, cannot find module `./quick-parse`.

- [ ] **Step 4: Implement quick-parse**

```ts
// src/domain/tasks/quick-parse.ts
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateFromToken(token: string, now: Date): string | null {
  const t = token.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === "today") return localDay(now);
  if (t === "tomorrow") return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const idx = WEEKDAYS.findIndex((w) => w === t || w.slice(0, 3) === t);
  if (idx === -1) return null;
  const delta = (idx - now.getDay() + 7) % 7; // today counts when it is that weekday
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta));
}

/** Parse "! Title fri" style shortcuts from an add-task input. Pure; `now` is injectable. */
export function quickParse(input: string, now: Date = new Date()): { title: string; priority: "high" | "normal"; dueDate: string | null } {
  let title = input.trim();
  let priority: "high" | "normal" = "normal";
  if (title.startsWith("!")) {
    priority = "high";
    title = title.slice(1).trim();
  } else if (title.endsWith("!")) {
    priority = "high";
    title = title.slice(0, -1).trim();
  }
  let dueDate: string | null = null;
  const words = title.split(/\s+/);
  if (words.length > 1) {
    const last = words[words.length - 1];
    const parsed = dateFromToken(last, now);
    if (parsed) {
      dueDate = parsed;
      words.pop();
      title = words.join(" ");
      if (title.endsWith("!")) {
        priority = "high";
        title = title.slice(0, -1).trim();
      }
    }
  }
  return { title: title.trim(), priority, dueDate };
}
```

- [ ] **Step 5: Run the quick-parse test**

Run: `npx vitest run src/domain/tasks/quick-parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Failing domain test**

```ts
// src/domain/tasks/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createContainer, deleteContainer } from "@/domain/containers";
import { createItem } from "@/domain/items";
import {
  createTask, getTask, listTasks, updateTask, completeTask, reopenTask, dropTask, deleteTask, reorderTasks, projectProgress, containerProgress, TaskError,
} from "./index";

describe("tasks domain", () => {
  let t: TestDb;
  let projectId: number;
  beforeEach(() => {
    t = makeTestDb();
    projectId = createContainer(t.db, { kind: "project", name: "Launch" }).id;
  });
  afterEach(() => t.cleanup());

  it("creates in append order, validates, and lists open first", () => {
    const a = createTask(t.db, { title: "  First  ", containerId: projectId });
    const b = createTask(t.db, { title: "Second", containerId: projectId, dueDate: "2026-09-20", priority: "high" });
    expect(a.title).toBe("First");
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);
    expect(() => createTask(t.db, { title: "   ", containerId: projectId })).toThrow(TaskError);
    expect(() => createTask(t.db, { title: "x", containerId: 999 })).toThrow(/not found/);
    expect(() => createTask(t.db, { title: "x", dueDate: "20-1-1" })).toThrow(/YYYY-MM-DD/);
    expect(() => createTask(t.db, { title: "x", sourceItemId: 999 })).toThrow(/not found/);
    completeTask(t.db, a.id);
    expect(listTasks(t.db, { containerId: projectId, status: "all" }).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(listTasks(t.db, { containerId: projectId }).map((x) => x.id)).toEqual([b.id]);
  });

  it("inbox tasks have a null container and list separately", () => {
    const inbox = createTask(t.db, { title: "Loose end" });
    createTask(t.db, { title: "Filed", containerId: projectId });
    expect(listTasks(t.db, { containerId: null }).map((x) => x.id)).toEqual([inbox.id]);
    expect(listTasks(t.db, {}).length).toBe(2);
  });

  it("complete sets and reopen clears completedAt; drop is excluded from progress", () => {
    const a = createTask(t.db, { title: "A", containerId: projectId });
    const b = createTask(t.db, { title: "B", containerId: projectId });
    const c = createTask(t.db, { title: "C", containerId: projectId });
    expect(completeTask(t.db, a.id).completedAt).not.toBeNull();
    expect(reopenTask(t.db, a.id).completedAt).toBeNull();
    completeTask(t.db, a.id);
    dropTask(t.db, c.id);
    const p = projectProgress(t.db, projectId);
    expect(p).toMatchObject({ open: 1, done: 1, total: 2, percent: 50 });
    expect(p.nextTask?.id).toBe(b.id);
    expect(projectProgress(t.db, 999)).toMatchObject({ open: 0, done: 0, total: 0, percent: 0, nextTask: null });
  });

  it("nextTask follows manual order, then earliest due date with nulls last", () => {
    const a = createTask(t.db, { title: "A", containerId: projectId, dueDate: "2026-09-30" });
    const b = createTask(t.db, { title: "B", containerId: projectId, dueDate: "2026-09-10" });
    expect(projectProgress(t.db, projectId).nextTask?.id).toBe(a.id);
    reorderTasks(t.db, projectId, [b.id, a.id]);
    expect(projectProgress(t.db, projectId).nextTask?.id).toBe(b.id);
  });

  it("reorders listed ids and keeps unlisted ones after them", () => {
    const [a, b, c, d] = ["A", "B", "C", "D"].map((title) => createTask(t.db, { title, containerId: projectId }));
    const out = reorderTasks(t.db, projectId, [c.id, a.id]);
    expect(out.map((x) => x.id)).toEqual([c.id, a.id, b.id, d.id]);
    expect(out.map((x) => x.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("updates fields, moves between containers appending at the end, and deletes", () => {
    const other = createContainer(t.db, { kind: "area", name: "Home" }).id;
    createTask(t.db, { title: "Existing", containerId: other });
    const a = createTask(t.db, { title: "A", containerId: projectId });
    const moved = updateTask(t.db, a.id, { containerId: other, priority: "low", dueDate: null, notes: "n" });
    expect(moved).toMatchObject({ containerId: other, priority: "low", sortOrder: 1, notes: "n" });
    expect(() => updateTask(t.db, a.id, { title: "" })).toThrow(TaskError);
    expect(() => updateTask(t.db, 999, { title: "x" })).toThrow(/not found/);
    deleteTask(t.db, a.id);
    expect(getTask(t.db, a.id)).toBeUndefined();
  });

  it("computes progress for many containers in one call and survives container deletion", () => {
    const other = createContainer(t.db, { kind: "project", name: "Other" }).id;
    createTask(t.db, { title: "A", containerId: projectId });
    completeTask(t.db, createTask(t.db, { title: "B", containerId: other }).id);
    const m = containerProgress(t.db, [projectId, other, 999]);
    expect(m.get(projectId)).toMatchObject({ open: 1, done: 0, percent: 0 });
    expect(m.get(other)).toMatchObject({ open: 0, done: 1, percent: 100, nextTask: null });
    expect(m.get(999)).toMatchObject({ total: 0 });
    const item = createItem(t.db, { type: "note", title: "n" });
    const fromItem = createTask(t.db, { title: "From note", containerId: other, sourceItemId: item.id });
    deleteContainer(t.db, other);
    expect(getTask(t.db, fromItem.id)?.containerId).toBeNull();
  });
});
```

`deleteContainer` requires the container to have no items (see its implementation); the test's `other` has none.

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run src/domain/tasks/index.test.ts`
Expected: FAIL, cannot find module `./index`.

- [ ] **Step 8: Implement the domain**

```ts
// src/domain/tasks/index.ts
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
```

Prune any unused import before committing; lint must be clean.

Note on `nextTask` ordering: sessions are ordered by `sortOrder` first, which is what the spec means by "first open task by sort_order, then earliest due date with nulls last" (the due-date keys only break ties between equal sort orders, which happen after container moves).

- [ ] **Step 9: Run the domain test**

Run: `npx vitest run src/domain/tasks/index.test.ts`
Expected: PASS.

- [ ] **Step 10: Failing migration test**

```ts
// src/domain/tasks/migrate-next-steps.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createContainer, getContainer, updateContainer } from "@/domain/containers";
import { listTasks } from "./index";
import { migrateNextSteps } from "./migrate-next-steps";
import { getSetting } from "@/domain/settings";

describe("migrateNextSteps", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("turns checkbox lines into tasks, keeps stray lines in the description, and runs once", () => {
    const p = createContainer(t.db, { kind: "project", name: "Launch", description: "Intro." });
    updateContainer(t.db, p.id, { nextSteps: "- [ ] Draft email\n* [X] Pick tool\nRemember the budget\n\n- [ ] Import contacts" });
    const untouched = createContainer(t.db, { kind: "area", name: "Home" });
    const r = migrateNextSteps(t.db);
    expect(r).toEqual({ containers: 1, tasks: 3 });
    const all = listTasks(t.db, { containerId: p.id, status: "all" });
    expect(all.map((x) => [x.title, x.status])).toEqual([
      ["Draft email", "open"],
      ["Import contacts", "open"],
      ["Pick tool", "done"],
    ]);
    expect(all.find((x) => x.title === "Pick tool")?.completedAt).not.toBeNull();
    const c = getContainer(t.db, p.id)!;
    expect(c.nextSteps).toBe("");
    expect(c.description).toBe("Intro.\n\n## Notes\n\nRemember the budget");
    expect(getSetting(t.db, "tasks_migrated", "0")).toBe("1");
    expect(getContainer(t.db, untouched.id)?.description).toBe("");
    expect(migrateNextSteps(t.db)).toEqual({ containers: 0, tasks: 0 });
    expect(listTasks(t.db, { containerId: p.id, status: "all" })).toHaveLength(3);
  });
});
```

`updateContainer` still accepts `nextSteps` at the domain level in this task (the API stops accepting it in Task 2), which is what the test relies on to seed data.

- [ ] **Step 11: Implement the migration**

```ts
// src/domain/tasks/migrate-next-steps.ts
import { eq, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, tasks } from "@/db/schema";
import { getSetting, setSetting } from "@/domain/settings";
import { nowIso } from "@/lib/time";

const CHECKBOX = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;

/** One-time: convert every container's next-steps checklist into tasks. Guarded by the `tasks_migrated` setting. */
export function migrateNextSteps(db: DB): { containers: number; tasks: number } {
  if (getSetting(db, "tasks_migrated", "0") === "1") return { containers: 0, tasks: 0 };
  const rows = db.select().from(containers).where(ne(containers.nextSteps, "")).all();
  let taskCount = 0;
  db.transaction((tx) => {
    for (const c of rows) {
      const lines = c.nextSteps.split("\n");
      const stray: string[] = [];
      let order = 0;
      const now = nowIso();
      for (const line of lines) {
        const m = CHECKBOX.exec(line);
        if (m) {
          const done = m[1].toLowerCase() === "x";
          tx.insert(tasks)
            .values({
              title: m[2],
              status: done ? "done" : "open",
              completedAt: done ? now : null,
              containerId: c.id,
              sortOrder: order++,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          taskCount++;
        } else if (line.trim()) {
          stray.push(line.trim());
        }
      }
      let description = c.description;
      const extra = stray.filter((s) => !description.includes(s));
      if (extra.length) description = `${description.trimEnd()}\n\n## Notes\n\n${extra.join("\n")}`.trimStart();
      tx.update(containers).set({ nextSteps: "", description, updatedAt: now }).where(eq(containers.id, c.id)).run();
    }
    setSetting(tx as unknown as DB, "tasks_migrated", "1");
  });
  return { containers: rows.length, tasks: taskCount };
}
```

If `setSetting` cannot take the transaction handle because of its type, write the setting with `tx.insert(settings).values({ key: "tasks_migrated", value: "1" }).onConflictDoUpdate({ target: settings.key, set: { value: "1" } }).run()` directly (import `settings` from the schema) and drop the cast.

The expected description in the test is `"Intro.\n\n## Notes\n\nRemember the budget"`; when the original description is empty the result is `"## Notes\n\nRemember the budget"`.

- [ ] **Step 12: Run all tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/db drizzle src/domain/tasks
git commit -m "feat(tasks): table, domain, quick-parse, and next-steps migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: API, DTOs, container integration, boot migration

**Files:**
- Create: `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/reorder/route.ts`, `src/app/api/tasks.test.ts`
- Modify: `src/lib/dto.ts`, `src/lib/api.ts`, `src/lib/validation.ts`, `src/domain/containers/index.ts`, `src/app/api/containers/[id]/archive/route.ts` (no change expected; verify), `src/server/boot.ts`, `src/app/api/para.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 1 domain.
- Produces:
  - `TaskDTO { id, title, notes, status, priority, dueDate, containerId, sourceItemId, completedAt, sortOrder, createdAt, updatedAt }`; `ProgressDTO = Progress`; `ContainerDTO.progress: ProgressDTO`; `serializeTask(t: Task): TaskDTO`.
  - Routes per the spec's table. `PATCH /api/tasks/[id]` accepts `status` and routes it: `done` → `completeTask`, `open` → `reopenTask`, `dropped` → `dropTask`, applied after the field patch.
  - `archiveContainer(db, id, opts)` also handles tasks: `opts.moveItemsTo === undefined` drops the container's open tasks; otherwise open tasks move to `moveItemsTo` (number or null), appended in their current order after the target's existing open tasks.
  - `PatchContainerBody`/`ContainerBody` drop `nextSteps` (a body containing it fails with 400 because zod objects are strict here? They are not strict by default; add `.strict()` to `ContainerBody` so unknown keys are rejected, and confirm existing callers send no unknown keys).
  - `boot()` calls `migrateNextSteps(db)` once and logs `[boot] migrated N next-steps checklists into M tasks` when N > 0.

- [ ] **Step 1: Failing API test**

```ts
// src/app/api/tasks.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: {
  tasks: typeof import("./tasks/route");
  task: typeof import("./tasks/[id]/route");
  reorder: typeof import("./tasks/reorder/route");
  containers: typeof import("./containers/route");
  container: typeof import("./containers/[id]/route");
  archive: typeof import("./containers/[id]/archive/route");
};
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    tasks: await import("./tasks/route"),
    task: await import("./tasks/[id]/route"),
    reorder: await import("./tasks/reorder/route"),
    containers: await import("./containers/route"),
    container: await import("./containers/[id]/route"),
    archive: await import("./containers/[id]/archive/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("tasks api", () => {
  let projectId: number;

  it("creates, lists with progress, patches, and rejects bad input", async () => {
    const created = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Launch" }));
    projectId = ((await created.json()) as { id: number }).id;
    const a = await r.tasks.POST(json("POST", "/api/tasks", { title: "Draft email", containerId: projectId, dueDate: "2026-09-20" }));
    expect(a.status).toBe(201);
    const aId = ((await a.json()) as { id: number }).id;
    await r.tasks.POST(json("POST", "/api/tasks", { title: "Pick tool", containerId: projectId }));
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "", containerId: projectId }))).status).toBe(400);
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "x", dueDate: "nope" }))).status).toBe(400);
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "x", containerId: 999 }))).status).toBe(404);
    const list = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}`))).json()) as { tasks: { id: number }[]; progress: { open: number; percent: number } };
    expect(list.tasks).toHaveLength(2);
    expect(list.progress).toMatchObject({ open: 2, percent: 0 });
    const done = await r.task.PATCH(json("PATCH", "/x", { status: "done", priority: "high" }), params(aId));
    expect((await done.json()) as { status: string; priority: string }).toMatchObject({ status: "done", priority: "high" });
    const after = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}&status=all`))).json()) as { progress: { done: number; percent: number } };
    expect(after.progress).toMatchObject({ done: 1, percent: 50 });
    expect((await r.task.PATCH(json("PATCH", "/x", { status: "weird" }), params(aId))).status).toBe(400);
    expect((await r.task.PATCH(json("PATCH", "/x", { title: "y" }), params(999))).status).toBe(404);
  });

  it("reorders, exposes progress on the container DTO, and rejects nextSteps", async () => {
    const list = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}`))).json()) as { tasks: { id: number; title: string }[] };
    const extra = await r.tasks.POST(json("POST", "/api/tasks", { title: "Import contacts", containerId: projectId }));
    const extraId = ((await extra.json()) as { id: number }).id;
    const re = await r.reorder.POST(json("POST", "/api/tasks/reorder", { containerId: projectId, ids: [extraId, list.tasks[0].id] }));
    expect(((await re.json()) as { tasks: { id: number }[] }).tasks.map((t) => t.id)[0]).toBe(extraId);
    const c = (await (await r.container.GET(json("GET", "/x"), params(projectId))).json()) as { progress: { open: number; done: number; nextTask: { id: number } } };
    expect(c.progress).toMatchObject({ open: 2, done: 1 });
    expect(c.progress.nextTask.id).toBe(extraId);
    expect((await r.container.PATCH(json("PATCH", "/x", { nextSteps: "- [ ] x" }), params(projectId))).status).toBe(400);
  });

  it("archiving a project drops or moves its open tasks", async () => {
    const other = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "area", name: "Home" }))).json()) as { id: number }).id;
    const p2 = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Second" }))).json()) as { id: number }).id;
    const t1 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "Move me", containerId: p2 }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x", { moveItemsTo: other }), params(p2));
    const moved = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${other}`))).json()) as { tasks: { id: number }[] };
    expect(moved.tasks.map((t) => t.id)).toContain(t1);
    const p3 = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Third" }))).json()) as { id: number }).id;
    const t2 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "Drop me", containerId: p3 }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x"), params(p3));
    const dropped = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${p3}&status=dropped`))).json()) as { tasks: { id: number }[] };
    expect(dropped.tasks.map((t) => t.id)).toEqual([t2]);
    const inboxMove = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Fourth" }))).json()) as { id: number }).id;
    const t3 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "To inbox", containerId: inboxMove }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x", { moveItemsTo: null }), params(inboxMove));
    const inbox = (await (await r.tasks.GET(json("GET", "/api/tasks?container=inbox"))).json()) as { tasks: { id: number }[] };
    expect(inbox.tasks.map((t) => t.id)).toContain(t3);
    expect((await r.task.DELETE(json("DELETE", "/x"), params(t3))).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/tasks.test.ts`
Expected: FAIL, cannot find the route modules.

- [ ] **Step 3: DTOs, serializer, validation, error mapping**

`src/lib/dto.ts` additions:

```ts
export interface ProgressDTO {
  open: number;
  done: number;
  total: number;
  percent: number;
  nextTask: { id: number; title: string; dueDate: string | null } | null;
}
export interface TaskDTO {
  id: number;
  title: string;
  notes: string;
  status: "open" | "done" | "dropped";
  priority: "low" | "normal" | "high";
  dueDate: string | null;
  containerId: number | null;
  sourceItemId: number | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

Add `progress: ProgressDTO;` to `ContainerDTO` (keep `nextSteps` in the DTO for now; it is always `""` after migration).

`src/lib/api.ts`: `serializeContainer` adds `progress: projectProgress(db, c.id)`; export `serializeTask(t: Task): TaskDTO` (a field copy); `errorResponse` maps `TaskError` (import from `@/domain/tasks`). Add `serializeContainers(db, list: Container[]): ContainerDTO[]` that calls `containerProgress` once for all ids and reuses it, and switch the projects, areas, resources, and archive pages to it (they currently map `serializeContainer` per row).

`src/lib/validation.ts`: remove `nextSteps` from `ContainerBody` and add `.strict()` to it; add

```ts
export const TaskBody = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: DateString.nullable().optional(),
  containerId: z.number().int().positive().nullable().optional(),
  sourceItemId: z.number().int().positive().nullable().optional(),
});
export const PatchTaskBody = TaskBody.partial().extend({ status: z.enum(TASK_STATUSES).optional() }).strict();
export const ReorderTasksBody = z.object({ containerId: z.number().int().positive().nullable(), ids: z.array(z.number().int().positive()) });
```

`src/domain/containers/index.ts`: remove `nextSteps` from `CreateContainerInput` and `UpdateContainerInput` handling in `createContainer`/`updateContainer` (the column keeps its default `""`); the migration in Task 1 writes the column directly. If the Task 1 migration test used `updateContainer({ nextSteps })`, change that test to write the column with `db.update(containers).set({ nextSteps }).where(...).run()` instead.

- [ ] **Step 4: Routes**

```ts
// src/app/api/tasks/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createTask, listTasks, projectProgress } from "@/domain/tasks";
import { errorResponse, parseId, serializeTask } from "@/lib/api";
import { TaskBody } from "@/lib/validation";
import { CaptureError } from "@/domain/items/capture";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    const raw = sp.get("container");
    const containerId = raw === null ? undefined : raw === "inbox" ? null : parseId(raw);
    const status = sp.get("status") ?? "open";
    if (!["open", "done", "dropped", "all"].includes(status)) throw new CaptureError("status must be open, done, dropped, or all", 400);
    const db = getDb();
    const tasks = listTasks(db, { containerId, status: status as "open" | "done" | "dropped" | "all" }).map(serializeTask);
    return NextResponse.json(typeof containerId === "number" ? { tasks, progress: projectProgress(db, containerId) } : { tasks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = TaskBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(serializeTask(createTask(getDb(), parsed.data)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`[id]/route.ts`: `PATCH` parses `PatchTaskBody`, calls `updateTask` with the field subset (only when at least one field is present), then applies `status` via `completeTask`/`reopenTask`/`dropTask`, and returns the final task; `DELETE` calls `deleteTask` and returns 204. `reorder/route.ts`: `POST` parses `ReorderTasksBody`, returns `{ tasks: reorderTasks(...).map(serializeTask) }`.

- [ ] **Step 5: Archive integration and boot**

In `src/domain/containers/index.ts` `archiveContainer`, inside the transaction, before archiving the row: import `tasks` from the schema and

```ts
const openTasks = tx.select().from(tasks).where(and(eq(tasks.containerId, id), eq(tasks.status, "open"))).orderBy(asc(tasks.sortOrder)).all();
if (opts.moveItemsTo === undefined) {
  tx.update(tasks).set({ status: "dropped", updatedAt: now }).where(and(eq(tasks.containerId, id), eq(tasks.status, "open"))).run();
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
```

Add a domain test case to `src/domain/containers/index.test.ts` mirroring the API's third case (drop on plain archive; move with `moveItemsTo`; inbox with `null`).

`src/server/boot.ts`: after `resetRunningJobs`, call `const m = migrateNextSteps(db); if (m.containers) console.log(\`[boot] migrated ${m.containers} next-steps checklist(s) into ${m.tasks} task(s)\`);` wrapped in try/catch that logs `[boot] next-steps migration failed:` and continues.

- [ ] **Step 6: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/app/api/tasks src/app/api/tasks.test.ts src/lib src/domain src/server/boot.ts src/app
git commit -m "feat(tasks): api routes, container progress, archive handling, boot migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Progress ring, project cards, projects page

**Files:**
- Create: `src/lib/deadline.ts`, `src/lib/deadline.test.ts`, `src/components/tasks/progress-ring.tsx`, `src/components/tasks/project-card.tsx`
- Modify: `src/app/projects/page.tsx`, `src/components/new-container-form.tsx`, `src/components/container-list.tsx` (project branch no longer used by `/projects`; keep for archive)

**Interfaces:**
- Produces:
  - `deadlineLabel(deadline: string | null, today: string): { text: string; tone: "muted" | "warn" | "danger" | "faint" }` — "No deadline" faint; "Due today" warn; "N days left" muted ("1 day left"); "N days overdue" danger ("1 day overdue").
  - `sortProjects<T extends { deadline: string | null; name: string }>(list: T[], today: string): T[]` — overdue first (most overdue first), then upcoming by nearest deadline, then no deadline; ties by name, case-insensitive.
  - `daysBetween(a: string, b: string): number` (calendar days from `a` to `b`, local, DST-safe by constructing local dates).
  - `ProgressRing({ percent, size = 36, stroke = 3, className? })`: SVG with `role="img"`, `aria-label="{percent}% done"`, track `var(--color-line)`, bar `var(--color-accent)` (or `var(--color-success)` when percent is 100), round caps, `transition: stroke-dashoffset 300ms` under `motion-safe`.
  - `ProjectCard({ project: ContainerDTO, today: string })`.

- [ ] **Step 1: Failing deadline test**

```ts
// src/lib/deadline.test.ts
import { describe, it, expect } from "vitest";
import { deadlineLabel, sortProjects, daysBetween } from "./deadline";

const today = "2026-09-16";

describe("deadline helpers", () => {
  it("labels deadlines by urgency", () => {
    expect(deadlineLabel(null, today)).toEqual({ text: "No deadline", tone: "faint" });
    expect(deadlineLabel("2026-09-16", today)).toEqual({ text: "Due today", tone: "warn" });
    expect(deadlineLabel("2026-09-17", today)).toEqual({ text: "1 day left", tone: "muted" });
    expect(deadlineLabel("2026-09-28", today)).toEqual({ text: "12 days left", tone: "muted" });
    expect(deadlineLabel("2026-09-15", today)).toEqual({ text: "1 day overdue", tone: "danger" });
    expect(deadlineLabel("2026-09-13", today)).toEqual({ text: "3 days overdue", tone: "danger" });
  });
  it("counts calendar days across a month boundary", () => {
    expect(daysBetween("2026-09-30", "2026-10-02")).toBe(2);
    expect(daysBetween("2026-10-02", "2026-09-30")).toBe(-2);
  });
  it("sorts overdue first, then nearest, then none, ties by name", () => {
    const list = [
      { name: "b none", deadline: null },
      { name: "Soon", deadline: "2026-09-20" },
      { name: "a none", deadline: null },
      { name: "Late", deadline: "2026-09-10" },
      { name: "Later", deadline: "2026-10-01" },
      { name: "Very late", deadline: "2026-09-01" },
    ];
    expect(sortProjects(list, today).map((p) => p.name)).toEqual(["Very late", "Late", "Soon", "Later", "a none", "b none"]);
  });
});
```

- [ ] **Step 2: Implement deadline.ts**

```ts
// src/lib/deadline.ts
function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((localDate(b).getTime() - localDate(a).getTime()) / 86_400_000);
}

export type DeadlineTone = "muted" | "warn" | "danger" | "faint";

export function deadlineLabel(deadline: string | null, today: string): { text: string; tone: DeadlineTone } {
  if (!deadline) return { text: "No deadline", tone: "faint" };
  const days = daysBetween(today, deadline);
  if (days === 0) return { text: "Due today", tone: "warn" };
  if (days > 0) return { text: `${days} day${days === 1 ? "" : "s"} left`, tone: "muted" };
  const over = -days;
  return { text: `${over} day${over === 1 ? "" : "s"} overdue`, tone: "danger" };
}

export function sortProjects<T extends { deadline: string | null; name: string }>(list: T[], today: string): T[] {
  const rank = (p: T) => (p.deadline ? (daysBetween(today, p.deadline) < 0 ? 0 : 1) : 2);
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
```

- [ ] **Step 3: Components**

`src/components/tasks/progress-ring.tsx`:

```tsx
export function ProgressRing({ percent, size = 36, stroke = 3, className = "" }: { percent: number; size?: number; stroke?: number; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = p >= 100 ? "var(--color-success)" : "var(--color-accent)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${p}% done`} className={className}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300"
      />
    </svg>
  );
}
```

`src/components/tasks/project-card.tsx` (server-safe, no hooks):

```tsx
import Link from "next/link";
import { Square } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { deadlineLabel } from "@/lib/deadline";
import { ProgressRing } from "./progress-ring";

const TONE: Record<string, string> = { muted: "text-fg-muted", warn: "text-warn", danger: "text-danger", faint: "text-fg-faint" };

export function ProjectCard({ project, today }: { project: ContainerDTO; today: string }) {
  const p = project.progress;
  const due = deadlineLabel(project.deadline, today);
  return (
    <Link
      href={`/c/${project.slug}`}
      className="focus-ring flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-5 transition-all duration-150 hover:border-line-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        <ProgressRing percent={p.percent} />
        <span className="font-mono text-[12px] text-fg-muted">{p.percent}%</span>
        <span className="flex-1" />
        <span className={`text-[12px] ${TONE[due.tone]}`}>{due.text}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-medium leading-5 line-clamp-2">{project.name}</div>
        {project.goal && <div className="text-[13px] text-fg-muted leading-5 line-clamp-2 mt-0.5">{project.goal}</div>}
      </div>
      <div className="border-t border-line pt-3 flex items-center gap-2 text-[13px] min-w-0">
        {p.nextTask ? (
          <>
            <Square className="w-3.5 h-3.5 text-fg-faint shrink-0" aria-hidden />
            <span className="truncate">{p.nextTask.title}</span>
          </>
        ) : p.total > 0 ? (
          <span className="text-success">All done</span>
        ) : (
          <span className="text-fg-faint">No open tasks</span>
        )}
      </div>
      <div className="font-mono text-[11px] text-fg-faint">
        {p.total} task{p.total === 1 ? "" : "s"}, {project.itemCount} item{project.itemCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
```

`src/app/projects/page.tsx`: compute `today` with the same local-day helper as `src/components/activity/format.ts` (`todayLocal()`), `projects = sortProjects(serializeContainers(db, listContainers(...)), today)`, `dueThisWeek = projects.filter(p => p.deadline && daysBetween(today, p.deadline) >= 0 && daysBetween(today, p.deadline) <= 7).length`; header meta `<><span className="font-mono">{n}</span> active, <span className="font-mono">{dueThisWeek}</span> due this week</>`; then `<NewContainerForm kind="project" />`; then `<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">` of `ProjectCard`s, or the existing `EmptyState` wording when none. Widen the page container to `max-w-5xl`.

`src/components/new-container-form.tsx`: button label becomes `Add ${kind}` ("Add project", "Add area", "Add resource").

- [ ] **Step 4: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/lib/deadline.ts src/lib/deadline.test.ts src/components/tasks src/app/projects/page.tsx src/components/new-container-form.tsx
git commit -m "feat(projects): progress cards with rings and deadlines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Task list, project hero, area tasks, README

**Files:**
- Create: `src/components/tasks/task-list.tsx`, `src/components/tasks/task-row.tsx`, `src/components/tasks/task-list.test.tsx`
- Modify: `src/components/container-editor.tsx`, `src/app/c/[slug]/page.tsx`, `src/components/complete-project-dialog.tsx` (copy only), `README.md`

**Interfaces:**
- Consumes: `/api/tasks*`, `TaskDTO`, `ProgressDTO`, `quickParse` (import from `@/domain/tasks/quick-parse`, it is pure and client-safe), `deadlineLabel`, `ProgressRing`.
- Produces: `TaskList({ containerId, initialTasks, initialProgress, onProgress?, today })`; `ContainerEditor` accepts `tasks: TaskDTO[]` and renders the hero for projects and the Tasks section for projects and areas.

- [ ] **Step 1: Failing component test**

```tsx
// src/components/tasks/task-list.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TaskList } from "./task-list";
import type { TaskDTO } from "@/lib/dto";

const base: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: 5, sourceItemId: null,
  completedAt: null, sortOrder: 0, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};
const progress = { open: 1, done: 0, total: 1, percent: 0, nextTask: { id: 1, title: "Draft email", dueDate: null } };

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

describe("TaskList", () => {
  it("adds a task on Enter using quick-parse and keeps focus", async () => {
    const calls: unknown[] = [];
    stub(async (url, init) => {
      if (init?.method === "POST" && url === "/api/tasks") {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ...base, id: 2, title: "Ship it", priority: "high", dueDate: "2026-09-18" }), { status: 201 });
      }
      return new Response(JSON.stringify({ tasks: [base], progress }), { status: 200 });
    });
    render(<TaskList containerId={5} initialTasks={[base]} initialProgress={progress} today="2026-09-16" />);
    const input = screen.getByPlaceholderText("Add a task") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "! Ship it fri" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(calls[0]).toMatchObject({ title: "Ship it", priority: "high", containerId: 5 });
    expect((calls[0] as { dueDate: string }).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(await screen.findByText("Ship it")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("marks done with one PATCH and reverts on failure", async () => {
    const patches: unknown[] = [];
    let fail = false;
    stub(async (url, init) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        if (fail) return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
        return new Response(JSON.stringify({ ...base, status: "done", completedAt: "2026-09-16T01:00:00.000Z" }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [base], progress }), { status: 200 });
    });
    render(<TaskList containerId={5} initialTasks={[base]} initialProgress={progress} today="2026-09-16" />);
    const box = screen.getByRole("checkbox", { name: "Draft email" }) as HTMLInputElement;
    await act(async () => { fireEvent.click(box); });
    expect(patches).toEqual([{ status: "done" }]);
    expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
    fail = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /1 done/ })); });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    await act(async () => { fireEvent.click(reopen); });
    expect(await screen.findByText("Could not save that change")).toBeTruthy();
    expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/tasks/task-list.test.tsx`
Expected: FAIL, cannot find module `./task-list`.

- [ ] **Step 3: Implement TaskList and TaskRow**

`task-list.tsx` (`"use client"`):
- State: `tasks: TaskDTO[]` (open and done, from `initialTasks`), `progress`, `error: string | null`, `showDone: boolean`, `draft: string`, `dragId: number | null`.
- Derived: `open = tasks.filter(t => t.status === "open").sort(bySortOrder)`, `done = tasks.filter(t => t.status === "done")`.
- `refresh()` fetches `/api/tasks?container=${containerId}&status=all` and replaces `tasks` and `progress` (calls `onProgress`).
- `mutate(optimistic: (prev) => TaskDTO[], request: () => Promise<Response>)`: apply optimistic state, await the request; on `!res.ok` restore the previous state and set `error` to "Could not save that change"; on success clear `error` and `refresh()`.
- Add row: `Input` with placeholder "Add a task" and `aria-label="Add a task"`; on Enter with a non-empty draft, `quickParse(draft)` then POST `{ title, priority (only when high), dueDate (only when set), containerId }`; on 201 push the returned task, clear the draft, keep focus (`ref.current?.focus()`); helper text under it in `text-[11.5px] text-fg-faint`: "Enter to add. End with a day like fri or a date; start with ! for high priority."
- Rows: render `TaskRow` for each open task inside `<ul role="list">`; when `done.length > 0` a `Button variant="ghost" size="sm"` with `aria-expanded={showDone}` labelled `${done.length} done` toggles a second list of done rows.
- Reorder: HTML5 drag on the open rows (`draggable`, `onDragStart` sets `dragId`, `onDragOver` prevents default, `onDrop` computes the new order and calls `mutate` with `POST /api/tasks/reorder { containerId, ids }`); Move up and Move down in the row menu do the same by swapping neighbours.
- Empty state: when `open.length === 0 && done.length === 0`, a line "No tasks yet. Add the first step below." in `text-fg-faint text-[13px]`.
- Error line: `text-danger text-[12.5px]` under the list while `error` is set.

`task-row.tsx` (`"use client"`), props `{ task, today, onToggle, onRename, onDue, onPriority, onDrop, onDelete, onMove(dir), draggable handlers }`:
- `<li role="listitem" className="group flex items-center gap-3 px-3 h-10 hover:bg-surface-2 transition-colors">`.
- Drag handle: a `span` with `GripVertical` icon, `aria-hidden`, visible on hover/focus-within, `cursor-grab`.
- Checkbox: `<input type="checkbox" className="focus-ring accent-accent w-4 h-4" checked={task.status === "done"} aria-label={task.title} onChange={onToggle} />`.
- Title: a `button` (`focus-ring text-left flex-1 min-w-0 truncate text-[13.5px]`, `line-through text-fg-faint` when done) that switches to an `Input size="sm"` on click or Enter; Enter saves via `onRename`, Escape cancels, blur saves when changed.
- Priority chip: only when `high` ("High", `Chip as="span"` with `text-warn border-warn/40`) or `low` ("Low", faint).
- Due chip: when set, a `button` in `font-mono text-[11px]` reading the short date ("Tue 23") coloured by `deadlineLabel(task.dueDate, today).tone` (danger overdue, warn today, muted otherwise); clicking reveals a date `Input size="sm"` that commits on change or blur (`onDue(value || null)`); when unset, the row menu's "Set due date" opens the same input.
- Menu: `IconButton label="Task actions" icon={MoreHorizontal}` opening a `panel` popover (Escape and outside click close, focus returns to the button) with buttons: Rename, Set due date, then a "Priority" line with three `Chip`s (`aria-pressed`), Move up, Move down, Drop, Delete (danger). Done rows show a "Reopen" `Button variant="ghost" size="sm"` instead of the menu.
- Short date: `formatShortDate(day)`: `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}` built from the local date (no `toLocale*`), reused from a tiny helper inside `task-row.tsx`.

- [ ] **Step 4: Container editor hero and sections**

`src/app/c/[slug]/page.tsx`: also load `tasks = listTasks(db, { containerId: c.id, status: "all" }).filter(t => t.status !== "dropped").map(serializeTask)` and pass `tasks={tasks}` and `today={todayLocal()}` to `ContainerEditor`.

`src/components/container-editor.tsx` changes (and nothing else):
1. Props gain `tasks: TaskDTO[]` and `today: string`; state `progress` initialised from `initial.progress`.
2. Remove the `nextSteps` state, its `latest` field, its place in the save body, and the "Next steps" section.
3. For projects, replace the goal/deadline grid with the hero:

```tsx
<section className="rounded-lg border border-line bg-surface-1 p-6 flex flex-col gap-4">
  {/* the existing name input moves here unchanged */}
  <input value={goal} onChange={...same handler...} placeholder="What does done look like?" className="text-[15px] text-fg-muted bg-transparent outline-none w-full border-b border-transparent focus:border-line-strong transition-colors duration-150" />
  <div className="flex items-center gap-5 flex-wrap">
    <div className="flex items-center gap-3">
      <ProgressRing percent={progress.percent} size={56} stroke={4} />
      <div className="text-[13px] text-fg-muted"><span className="font-mono text-fg">{progress.done}</span> of <span className="font-mono text-fg">{progress.total}</span> done</div>
    </div>
    <DeadlineControl value={deadline} today={today} onChange={(v) => { setDeadline(v); mark(); }} />
    <span className="flex-1" />
    {c.status === "active" && <Button variant="primary" icon={Check} onClick={() => setComplete(true)}>Complete</Button>}
  </div>
</section>
```

`DeadlineControl` (local component in the same file): a `Chip icon={CalendarDays}` reading `Due 28 Sep, 12 days left` (date via `formatDate` from `src/lib/format.ts` plus `deadlineLabel`) or "Set a deadline"; click reveals `Input type="date" size="sm" className="font-mono w-40"` with autofocus that hides on blur. The Complete button is removed from the toolbar for projects (it now lives in the hero); the toolbar keeps every other control unchanged.
4. For areas and projects, insert `<section className="flex flex-col gap-2"><SectionHeading count={progress.open}>Tasks</SectionHeading><TaskList containerId={c.id} initialTasks={tasks} initialProgress={progress} onProgress={setProgress} today={today} /></section>` before the Notes section; the description editor gets `<SectionHeading>Notes</SectionHeading>` above it.
5. Area pages: header meta stays; the `PageHeader`-less layout gains the tasks section; no ring.

`complete-project-dialog.tsx`: the first option's label becomes "Archive them with it (open tasks are dropped)"; the other three keep their labels. No logic change.

- [ ] **Step 5: README**

Under "How things are organised" add a "Tasks" paragraph: tasks belong to a project or area; add one from the project page (Enter adds; end with a day like `fri` or a date; start with `!` for high priority); check them off, drag to reorder, and the project card shows progress and the next task; the old next-steps checklist was converted into tasks the first time the app started after this update.

- [ ] **Step 6: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/components src/app README.md
git commit -m "feat(tasks): task list, project hero, and area tasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: data model (2) → Task 1; domain (3) → Task 1; API and container integration (4) → Task 2; migration (5) → Tasks 1 and 2; project list (6) → Task 3; project detail, area detail, `TaskList`, progress ring (6) → Tasks 3 and 4; errors (7) → optimistic rollback in Task 4, boot try/catch in Task 2; testing (8) → each task; implementation order (9) matches.
- Placeholders: none.
- Type consistency: `Progress`/`ProgressDTO` share a shape; `serializeTask`, `serializeContainers`, `quickParse`, `deadlineLabel`, `sortProjects`, `daysBetween`, `ProgressRing`, `ProjectCard`, `TaskList`, `TaskRow`, `DeadlineControl` names match across tasks; `ContainerEditor` props gain `tasks` and `today` in Task 4 and the page passes both.
