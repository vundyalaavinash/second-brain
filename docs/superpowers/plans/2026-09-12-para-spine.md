# PARA Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organise everything captured with the PARA method (Projects, Areas, Resources, Archive) plus an Inbox processing flow, a duplicate check on link capture, a lightweight People CRM, and a floating dock that replaces the sidebar.

**Architecture:** One `containers` table holds projects, areas, and resources with a `kind` column; every item has one `container_id` or sits in the Inbox (null). Archive is a state (`archived_at`) on containers and items. People are a small table joined to items. All new behaviour lives in domain modules (`src/domain/containers`, `src/domain/people`, additions to `src/domain/items`) with thin API routes and client components on top. The dock is a fixed, bottom-centred pill driven by one navigation manifest.

**Tech Stack:** Unchanged from the foundation: Next.js 16 App Router, React 19, Tailwind 4, better-sqlite3 + Drizzle 0.45, zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-12-second-brain-design.md` sections 3 (containers, people, items columns), 4 (inbox default, duplicate check), 5.1 (PARA organisation), 11 (dock, Inbox, Projects, Areas, Resources, People, Archive, Library and Search filters).

## Global Constraints

- Everything from the foundation plan's Global Constraints still applies: npm only, port 3141, `SB_DATA_DIR`, BigInt rowids for `chunks_vec`, pristine test output, the two commit trailer lines on every commit, `npm test` before every commit, `npm run build` at the end of every UI task.
- Container kinds: `project`, `area`, `resource`. Container statuses: `active`, `archived`. Resource categories: `articles`, `tools`, `reference`, `research`, `inspiration`, `videos`, `other`.
- Single home: an item's `container_id` is one container or null (Inbox). Archive is `archived_at` on the item or its container, never a container kind.
- `listItems` and `search` hide archived items unless `includeArchived` is true. Inbox = `container_id IS NULL AND archived_at IS NULL`.
- Duplicate link check: normalise by lowercasing scheme and host, dropping the hash, removing a trailing slash (except the root path), and stripping query parameters named `utm_*`, `fbclid`, `gclid`, `ref`, `mc_cid`, `mc_eid`. A match returns HTTP 409 with `existingId`; `force: true` saves anyway.
- Client components import enums from `@/db/enums` and types from `@/lib/dto`; never `@/db/schema` or `@/db/client`.
- Visual direction unchanged: dark, dense, one accent, Geist Mono for ids and counts, 120 to 180 ms motion.
- Existing behaviour must keep working: all 74 foundation tests stay green (a few need the new default of hiding archived items, which does not affect them).

## File Structure

```
src/
  db/
    enums.ts                    + CONTAINER_KINDS, CONTAINER_STATUSES, RESOURCE_CATEGORIES
    schema.ts                   + containers, people, itemPeople; items.containerId, items.archivedAt
  domain/
    containers/index.ts         slugify, create/get/list/update/archive/restore/delete, item counts
    people/index.ts             create/get/list/update/delete, item links, timeline, @mention auto-link
    items/index.ts              + containerId/archived filters, fileItem, archiveItem, restoreItem, countInbox
    items/dedupe.ts             normalizeUrl, findLinkByUrl
    items/capture.ts            + containerId on capture, force flag, DuplicateError
    search/filter.ts            + containerId, includeArchived
  lib/
    dto.ts                      + ContainerDTO, PersonDTO; ItemDTO gains containerId, archivedAt, container, people
    api.ts                      + serializeContainer, serializePerson; errorResponse carries existingId
  app/api/
    containers/route.ts, containers/[id]/route.ts, containers/[id]/archive/route.ts, containers/[id]/restore/route.ts
    inbox/route.ts
    people/route.ts, people/[id]/route.ts
    items/route.ts (+container, archived, containerId, force), items/[id]/route.ts (+containerId, archived, people)
    upload/route.ts (+containerId), search/route.ts (+container, archived)
  components/
    nav.ts                      NAV_ITEMS manifest (replaces the export from sidebar.tsx)
    icons.tsx                   line icons for the dock
    dock.tsx                    floating dock with inbox badge
    container-picker.tsx        modal list of containers with create-new
    inbox-processor.tsx         one-at-a-time processing flow
    container-list.tsx, new-container-form.tsx, container-editor.tsx, complete-project-dialog.tsx
    person-editor.tsx, people-picker.tsx
    capture-box.tsx             + file-to picker, 409 handling
    item-editor.tsx             + container chip, archive, people
    search-panel.tsx            + container filter, archived toggle
    restore-button.tsx
  app/
    layout.tsx                  dock instead of sidebar
    inbox/page.tsx, projects/page.tsx, areas/page.tsx, resources/page.tsx, c/[slug]/page.tsx
    archive/page.tsx, people/page.tsx, people/[slug]/page.tsx
    library/page.tsx            + container filter, archived toggle
    capture/page.tsx            + ?to= param
```

---

### Task 1: Schema for containers, people, and item homes

**Files:**
- Modify: `src/db/enums.ts`, `src/db/schema.ts`
- Create: `drizzle/0001_*.sql` (generated)
- Test: `src/db/client.test.ts` (extend)

**Interfaces:**
- Produces: `CONTAINER_KINDS`, `ContainerKind`, `CONTAINER_STATUSES`, `ContainerStatus`, `RESOURCE_CATEGORIES`, `ResourceCategory` from `@/db/enums` (re-exported from `@/db/schema`); tables `containers`, `people`, `itemPeople`; types `Container`, `NewContainer`, `Person`; `items.containerId` (nullable, set null on container delete) and `items.archivedAt` (nullable).

- [ ] **Step 1: Write the failing test**

Append to `src/db/client.test.ts` inside the `describe("openDatabase")` block:

```ts
  it("has containers, people, and item homes", () => {
    t = makeTestDb();
    const cols = (table: string) =>
      (t.db.$client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("containers")).toEqual(
      expect.arrayContaining(["id", "kind", "name", "slug", "status", "goal", "deadline", "standard", "category", "next_steps", "sort_order", "archived_at"]),
    );
    expect(cols("people")).toEqual(expect.arrayContaining(["id", "name", "slug", "profile"]));
    expect(cols("item_people")).toEqual(expect.arrayContaining(["item_id", "person_id"]));
    expect(cols("items")).toEqual(expect.arrayContaining(["container_id", "archived_at"]));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/db/client.test.ts`
Expected: FAIL, `containers` table has no columns (PRAGMA returns empty).

- [ ] **Step 3: Add the enums**

Append to `src/db/enums.ts`:

```ts
export const CONTAINER_KINDS = ["project", "area", "resource"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export const CONTAINER_STATUSES = ["active", "archived"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export const RESOURCE_CATEGORIES = ["articles", "tools", "reference", "research", "inspiration", "videos", "other"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];
```

- [ ] **Step 4: Extend the schema**

In `src/db/schema.ts`, change the two import/re-export lines at the top to:

```ts
import { ITEM_TYPES, ITEM_STATUSES, JOB_TYPES, JOB_STATUSES, CONTAINER_KINDS, CONTAINER_STATUSES, RESOURCE_CATEGORIES } from "./enums";

export { ITEM_TYPES, ITEM_STATUSES, JOB_TYPES, JOB_STATUSES, CONTAINER_KINDS, CONTAINER_STATUSES, RESOURCE_CATEGORIES } from "./enums";
export type { ItemType, ItemStatus, JobType, JobStatus, ContainerKind, ContainerStatus, ResourceCategory } from "./enums";
```

Insert the `containers` table BEFORE `items`:

```ts
export const containers = sqliteTable(
  "containers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: CONTAINER_KINDS }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: CONTAINER_STATUSES }).notNull().default("active"),
    goal: text("goal").notNull().default(""),
    deadline: text("deadline"),
    standard: text("standard").notNull().default(""),
    category: text("category", { enum: RESOURCE_CATEGORIES }),
    nextSteps: text("next_steps").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("containers_kind_status_idx").on(t.kind, t.status)],
);
```

In the `items` table, add after `reviewWeek`:

```ts
    containerId: integer("container_id").references(() => containers.id, { onDelete: "set null" }),
    archivedAt: text("archived_at"),
```

and add two indexes to the items index array: `index("items_container_idx").on(t.containerId)`, `index("items_archived_idx").on(t.archivedAt)`.

After the `itemTags` table, add:

```ts
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  profile: text("profile").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const itemPeople = sqliteTable(
  "item_people",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.personId] })],
);
```

At the bottom add:

```ts
export type Container = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;
export type Person = typeof people.$inferSelect;
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0001_*.sql` creating `containers`, `people`, `item_people` and altering `items`. drizzle-kit may express the `items` change as a table recreation; that is acceptable because the FTS triggers are on `chunks`, not `items`. Commit the generated SQL and `drizzle/meta`.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: all pass, including the new schema test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): containers, people, item homes and archive columns

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Containers domain

**Files:**
- Create: `src/domain/containers/index.ts`
- Test: `src/domain/containers/index.test.ts`

**Interfaces:**
- Consumes: `containers`, `items`, `Container`, `ContainerKind`, `ContainerStatus`, `ResourceCategory` from `@/db/schema`; `nowIso`.
- Produces:
  - `slugify(name: string): string`
  - `interface CreateContainerInput { kind; name; description?; goal?; deadline?: string | null; standard?; category?: ResourceCategory | null; nextSteps? }`
  - `interface UpdateContainerInput { name?; description?; goal?; deadline?: string | null; standard?; category?: ResourceCategory | null; nextSteps?; sortOrder? }`
  - `createContainer(db, input): Container`, `getContainer(db, id): Container | undefined`, `getContainerBySlug(db, slug): Container | undefined`
  - `listContainers(db, filter?: { kind?: ContainerKind; status?: ContainerStatus }): Container[]` (projects by deadline, nulls last; others by sort order then name)
  - `updateContainer(db, id, patch): Container`
  - `archiveContainer(db, id, opts?: { moveItemsTo?: number | null }): Container` — without `moveItemsTo`, the container's items are archived with it; with it (a container id or null for Inbox), the items are re-homed and left active
  - `restoreContainer(db, id): Container` — restores the container and its archived items
  - `deleteContainer(db, id): void` — only when it has no items (throws otherwise)
  - `countContainerItems(db, id, includeArchived?: boolean): number`
  - `class ContainerError extends Error { status: number }` (400 default, 404 for not found, 409 for delete-with-items)

- [ ] **Step 1: Write the failing tests**

Create `src/domain/containers/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem } from "@/domain/items";
import {
  slugify,
  createContainer,
  getContainer,
  getContainerBySlug,
  listContainers,
  updateContainer,
  archiveContainer,
  restoreContainer,
  deleteContainer,
  countContainerItems,
  ContainerError,
} from "./index";

describe("containers domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("slugifies names", () => {
    expect(slugify("  Launch v2: The Big One! ")).toBe("launch-v2-the-big-one");
    expect(slugify("Ünïcode & stuff")).toBe("unicode-stuff");
    expect(slugify("!!!")).toBe("container");
  });

  it("creates containers with unique slugs and kind defaults", () => {
    const a = createContainer(t.db, { kind: "project", name: "Launch", goal: "Ship it", deadline: "2026-10-01" });
    const b = createContainer(t.db, { kind: "area", name: "Launch" });
    expect(a.slug).toBe("launch");
    expect(b.slug).toBe("launch-2");
    expect(a.status).toBe("active");
    expect(a.goal).toBe("Ship it");
    expect(getContainer(t.db, a.id)?.deadline).toBe("2026-10-01");
    expect(getContainerBySlug(t.db, "launch-2")?.kind).toBe("area");
    const r = createContainer(t.db, { kind: "resource", name: "Baking" });
    expect(r.category).toBe("other");
  });

  it("lists by kind and status with the right ordering", () => {
    const late = createContainer(t.db, { kind: "project", name: "Late", deadline: "2026-12-01" });
    const none = createContainer(t.db, { kind: "project", name: "No deadline" });
    const soon = createContainer(t.db, { kind: "project", name: "Soon", deadline: "2026-10-01" });
    const areaB = createContainer(t.db, { kind: "area", name: "Health" });
    const areaA = createContainer(t.db, { kind: "area", name: "Finance" });
    expect(listContainers(t.db, { kind: "project" }).map((c) => c.id)).toEqual([soon.id, late.id, none.id]);
    expect(listContainers(t.db, { kind: "area" }).map((c) => c.id)).toEqual([areaA.id, areaB.id]);
    updateContainer(t.db, areaB.id, { sortOrder: -1 });
    expect(listContainers(t.db, { kind: "area" }).map((c) => c.id)).toEqual([areaB.id, areaA.id]);
    archiveContainer(t.db, late.id);
    expect(listContainers(t.db, { kind: "project", status: "active" }).map((c) => c.id)).toEqual([soon.id, none.id]);
    expect(listContainers(t.db, { status: "archived" }).map((c) => c.id)).toEqual([late.id]);
    expect(listContainers(t.db)).toHaveLength(5);
  });

  it("updates fields and rejects unknown ids", () => {
    const c = createContainer(t.db, { kind: "resource", name: "Tools" });
    const u = updateContainer(t.db, c.id, { category: "tools", description: "Handy things", name: "Tooling" });
    expect(u.category).toBe("tools");
    expect(u.name).toBe("Tooling");
    expect(u.slug).toBe("tools");
    expect(() => updateContainer(t.db, 999, { name: "x" })).toThrow(ContainerError);
  });

  it("archives with its items, or re-homes them, and restores", () => {
    const p = createContainer(t.db, { kind: "project", name: "P" });
    const a = createContainer(t.db, { kind: "area", name: "A" });
    const i1 = createItem(t.db, { type: "note", title: "one", containerId: p.id });
    const i2 = createItem(t.db, { type: "note", title: "two", containerId: p.id });
    expect(countContainerItems(t.db, p.id)).toBe(2);

    const archived = archiveContainer(t.db, p.id);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(getItem(t.db, i1.id)?.archivedAt).toBeTruthy();
    expect(countContainerItems(t.db, p.id)).toBe(0);
    expect(countContainerItems(t.db, p.id, true)).toBe(2);

    const restored = restoreContainer(t.db, p.id);
    expect(restored.status).toBe("active");
    expect(getItem(t.db, i2.id)?.archivedAt).toBeNull();

    archiveContainer(t.db, p.id, { moveItemsTo: a.id });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
    expect(getItem(t.db, i1.id)?.archivedAt).toBeNull();
    restoreContainer(t.db, p.id);
    archiveContainer(t.db, p.id, { moveItemsTo: null });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
  });

  it("deletes only empty containers", () => {
    const p = createContainer(t.db, { kind: "project", name: "P" });
    createItem(t.db, { type: "note", title: "x", containerId: p.id });
    expect(() => deleteContainer(t.db, p.id)).toThrow(/items/);
    const empty = createContainer(t.db, { kind: "project", name: "E" });
    deleteContainer(t.db, empty.id);
    expect(getContainer(t.db, empty.id)).toBeUndefined();
  });
});
```

This test uses `createItem(..., { containerId })`, which Task 3 adds. Implement Task 3's `CreateItemInput.containerId` line now as part of this task (it is a one-line addition) so the test compiles: in `src/domain/items/index.ts` add `containerId?: number | null;` to `CreateItemInput` and `containerId: input.containerId ?? null,` to the insert values in `createItem`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/containers/index.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement the domain**

Create `src/domain/containers/index.ts`:

```ts
import { and, asc, eq, isNull, isNotNull, sql, count } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, items, type Container, type ContainerKind, type ContainerStatus, type ResourceCategory } from "@/db/schema";
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
  nextSteps?: string;
}

export interface UpdateContainerInput {
  name?: string;
  description?: string;
  goal?: string;
  deadline?: string | null;
  standard?: string;
  category?: ResourceCategory | null;
  nextSteps?: string;
  sortOrder?: number;
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
      nextSteps: input.nextSteps ?? "",
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
  if (patch.nextSteps !== undefined) set.nextSteps = patch.nextSteps;
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

/** Restore a container and every archived item still filed in it. */
export function restoreContainer(db: DB, id: number): Container {
  requireContainer(db, id);
  const now = nowIso();
  return db.transaction((tx) => {
    tx.update(items)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(eq(items.containerId, id), isNotNull(items.archivedAt)))
      .run();
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
  db.delete(containers).where(eq(containers.id, id)).run();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/domain/containers/index.test.ts` then `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: containers domain for projects, areas, and resources

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Item homes, archive, inbox, and search filters

**Files:**
- Modify: `src/domain/items/index.ts`, `src/domain/search/filter.ts`
- Test: `src/domain/items/index.test.ts` (extend), `src/domain/search/index.test.ts` (extend)

**Interfaces:**
- Produces in `@/domain/items`:
  - `CreateItemInput.containerId?: number | null` (added in Task 2), `UpdateItemInput.containerId?: number | null`, `UpdateItemInput.archivedAt?: string | null`
  - `ListItemsFilter.containerId?: number | null` (null selects the Inbox), `ListItemsFilter.includeArchived?: boolean` (default false)
  - `fileItem(db, id, containerId: number | null): Item`, `archiveItem(db, id): Item`, `restoreItem(db, id): Item`, `countInbox(db): number`
- Produces in `@/domain/search/filter`: `SearchFilter.containerId?: number | null`, `SearchFilter.includeArchived?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/items/index.test.ts` inside the describe block:

```ts
  it("files items, hides archived by default, and counts the inbox", () => {
    const inbox1 = createItem(t.db, { type: "note", title: "in1" });
    const inbox2 = createItem(t.db, { type: "note", title: "in2" });
    const homed = createItem(t.db, { type: "note", title: "homed", containerId: null });
    expect(countInbox(t.db)).toBe(3);

    // A real container is needed; insert one directly so this test does not depend on the containers domain.
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (kind, name, slug, created_at, updated_at) VALUES ('project', 'P', 'p', ?, ?)")
      .run(now, now);
    const containerId = (t.db.$client.prepare("SELECT id FROM containers WHERE slug = 'p'").get() as { id: number }).id;

    expect(fileItem(t.db, homed.id, containerId).containerId).toBe(containerId);
    expect(countInbox(t.db)).toBe(2);
    expect(listItems(t.db, { containerId }).map((i) => i.id)).toEqual([homed.id]);
    expect(listItems(t.db, { containerId: null }).map((i) => i.id)).toEqual([inbox2.id, inbox1.id]);

    expect(archiveItem(t.db, inbox1.id).archivedAt).toBeTruthy();
    expect(countInbox(t.db)).toBe(1);
    expect(listItems(t.db).map((i) => i.id)).toEqual([homed.id, inbox2.id]);
    expect(listItems(t.db, { includeArchived: true })).toHaveLength(3);
    expect(restoreItem(t.db, inbox1.id).archivedAt).toBeNull();
    expect(fileItem(t.db, homed.id, null).containerId).toBeNull();
    expect(() => fileItem(t.db, homed.id, 9999)).toThrow(/not found/);
  });
```

Add `countInbox, fileItem, archiveItem, restoreItem` to the import list at the top of that test file.

Append to `src/domain/search/index.test.ts` inside the describe block:

```ts
  it("filters by container and hides archived items unless asked", async () => {
    const { embed, tomato, garden } = await seed(t);
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (kind, name, slug, created_at, updated_at) VALUES ('area', 'Garden', 'garden', ?, ?)")
      .run(now, now);
    const containerId = (t.db.$client.prepare("SELECT id FROM containers WHERE slug = 'garden'").get() as { id: number }).id;
    t.db.$client.prepare("UPDATE items SET container_id = ? WHERE id = ?").run(containerId, garden.id);
    t.db.$client.prepare("UPDATE items SET archived_at = ? WHERE id = ?").run(now, tomato.id);

    const homed = await search(t.db, embed, "tomato garden", { containerId });
    expect(homed.map((r) => r.item.id)).toEqual([garden.id]);
    const inbox = await search(t.db, embed, "tomato garden", { containerId: null });
    expect(inbox.map((r) => r.item.id)).not.toContain(garden.id);
    expect(inbox.map((r) => r.item.id)).not.toContain(tomato.id);
    const all = await search(t.db, embed, "tomato garden", { includeArchived: true });
    expect(all.map((r) => r.item.id)).toContain(tomato.id);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/domain/items/index.test.ts src/domain/search/index.test.ts`
Expected: FAIL on missing exports and on archived items still appearing.

- [ ] **Step 3: Implement**

In `src/domain/items/index.ts`:

Add to the drizzle import: `isNull, isNotNull, count` (final line: `import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lte, count } from "drizzle-orm";` — keep whatever is already imported).

Extend `UpdateItemInput` with:

```ts
  containerId?: number | null;
  archivedAt?: string | null;
```

and in `updateItem` add:

```ts
  if (patch.containerId !== undefined) set.containerId = patch.containerId;
  if (patch.archivedAt !== undefined) set.archivedAt = patch.archivedAt;
```

Extend `ListItemsFilter` with:

```ts
  /** A container id, or null for the Inbox. Omit for any home. */
  containerId?: number | null;
  /** Archived items are hidden unless this is true. */
  includeArchived?: boolean;
```

In `listItems`, after the `status` condition add:

```ts
  if (filter.containerId === null) conds.push(isNull(items.containerId));
  else if (typeof filter.containerId === "number") conds.push(eq(items.containerId, filter.containerId));
  if (!filter.includeArchived) conds.push(isNull(items.archivedAt));
```

Append these functions:

```ts
/** Move an item to a container (or the Inbox with null). */
export function fileItem(db: DB, id: number, containerId: number | null): Item {
  if (containerId !== null) {
    const exists = db.$client.prepare("SELECT id FROM containers WHERE id = ?").get(containerId);
    if (!exists) throw new Error(`Container ${containerId} not found`);
  }
  return updateItem(db, id, { containerId });
}

export function archiveItem(db: DB, id: number): Item {
  return updateItem(db, id, { archivedAt: nowIso() });
}

export function restoreItem(db: DB, id: number): Item {
  return updateItem(db, id, { archivedAt: null });
}

export function countInbox(db: DB): number {
  const row = db
    .select({ c: count() })
    .from(items)
    .where(and(isNull(items.containerId), isNull(items.archivedAt)))
    .get();
  return row?.c ?? 0;
}
```

`fileItem` checks the container with raw SQL rather than importing the containers domain, to keep the items module free of a dependency on it.

In `src/domain/search/filter.ts`, extend `SearchFilter`:

```ts
  /** A container id, or null for the Inbox. Omit for any home. */
  containerId?: number | null;
  /** Archived items are hidden unless this is true. */
  includeArchived?: boolean;
```

and in `filterSql`, before the `return`:

```ts
  if (filter.containerId === null) where += " AND i.container_id IS NULL";
  else if (typeof filter.containerId === "number") {
    where += " AND i.container_id = ?";
    params.push(filter.containerId);
  }
  if (!filter.includeArchived) where += " AND i.archived_at IS NULL";
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: item homes, archive state, inbox count, and container search filters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Duplicate check and capture homes

**Files:**
- Create: `src/domain/items/dedupe.ts`
- Modify: `src/domain/items/capture.ts`
- Test: `src/domain/items/dedupe.test.ts`, `src/domain/items/capture.test.ts` (extend)

**Interfaces:**
- Produces: `normalizeUrl(raw: string): string`, `findLinkByUrl(db, url: string): Item | undefined`; `class DuplicateError extends CaptureError { existingId: number }` (status 409); `captureNote/captureLink/captureFile` accept `containerId?: number | null`; `captureLink` accepts `force?: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/domain/items/dedupe.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem } from "./index";
import { normalizeUrl, findLinkByUrl } from "./dedupe";

describe("normalizeUrl", () => {
  it("lowercases scheme and host, strips hash, trailing slash, and tracking params", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path/?utm_source=x&b=2&fbclid=1#frag")).toBe("https://example.com/Path?b=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/a/b/")).toBe("https://example.com/a/b");
    expect(normalizeUrl("https://example.com/a?ref=twitter&gclid=9&mc_cid=1&mc_eid=2")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/a?z=1&a=2")).toBe("https://example.com/a?z=1&a=2");
  });
});

describe("findLinkByUrl", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("finds an existing link by normalised url, ignoring archived ones and notes", () => {
    const link = createItem(t.db, { type: "link", title: "x", sourceUrl: "https://Example.com/post/?utm_campaign=a" });
    createItem(t.db, { type: "note", title: "n", body: "https://example.com/post" });
    expect(findLinkByUrl(t.db, "https://example.com/post#top")?.id).toBe(link.id);
    expect(findLinkByUrl(t.db, "https://example.com/other")).toBeUndefined();
    t.db.$client.prepare("UPDATE items SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), link.id);
    expect(findLinkByUrl(t.db, "https://example.com/post")).toBeUndefined();
  });
});
```

Append to `src/domain/items/capture.test.ts` inside the describe block:

```ts
  it("captures into a container and rejects duplicate links unless forced", () => {
    const now = new Date().toISOString();
    t.db.$client
      .prepare("INSERT INTO containers (kind, name, slug, created_at, updated_at) VALUES ('project', 'P', 'p', ?, ?)")
      .run(now, now);
    const containerId = (t.db.$client.prepare("SELECT id FROM containers WHERE slug = 'p'").get() as { id: number }).id;

    const note = captureNote(t.db, { body: "homed note", containerId });
    expect(note.containerId).toBe(containerId);
    const first = captureLink(t.db, { url: "https://example.test/dup?utm_source=a", containerId });
    expect(first.containerId).toBe(containerId);
    try {
      captureLink(t.db, { url: "https://example.test/dup" });
      throw new Error("expected DuplicateError");
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateError);
      expect((e as DuplicateError).status).toBe(409);
      expect((e as DuplicateError).existingId).toBe(first.id);
    }
    const forced = captureLink(t.db, { url: "https://example.test/dup", force: true });
    expect(forced.id).not.toBe(first.id);
    const file = captureFile(t.db, { bytes: Buffer.from("t"), name: "n.txt", mime: "text/plain", containerId });
    expect(file.containerId).toBe(containerId);
  });
```

Add `DuplicateError` to the import from `./capture` in that test file.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/domain/items/dedupe.test.ts src/domain/items/capture.test.ts`
Expected: FAIL, cannot resolve `./dedupe`; `DuplicateError` missing.

- [ ] **Step 3: Implement dedupe**

Create `src/domain/items/dedupe.ts`:

```ts
import { and, eq, isNull, like } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type Item } from "@/db/schema";

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|ref|mc_cid|mc_eid)$/i;

/** Canonical form of a url for duplicate detection. Throws on an invalid url. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING_PARAM.test(k)) kept.append(k, v);
  u.search = kept.toString() ? `?${kept.toString()}` : "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** The active link item whose url normalises to the same value, if any. */
export function findLinkByUrl(db: DB, url: string): Item | undefined {
  let target: string;
  let host: string;
  try {
    target = normalizeUrl(url);
    host = new URL(target).host;
  } catch {
    return undefined;
  }
  const candidates = db
    .select()
    .from(items)
    .where(and(eq(items.type, "link"), isNull(items.archivedAt), like(items.sourceUrl, `%${host}%`)))
    .all();
  for (const c of candidates) {
    if (!c.sourceUrl) continue;
    try {
      if (normalizeUrl(c.sourceUrl) === target) return c;
    } catch {
      /* skip unparsable stored urls */
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Extend capture**

In `src/domain/items/capture.ts`:

Add after the `CaptureError` class:

```ts
export class DuplicateError extends CaptureError {
  constructor(public readonly existingId: number) {
    super("This link is already saved", 409);
    this.name = "DuplicateError";
  }
}
```

Add `import { findLinkByUrl } from "./dedupe";` to the imports.

Change the three capture signatures and bodies:

```ts
export function captureNote(db: DB, input: { title?: string; body: string; tags?: string[]; containerId?: number | null }): Item {
  const title = input.title?.trim() || deriveTitle(input.body);
  const item = createItem(db, { type: "note", title, body: input.body, containerId: input.containerId ?? null });
  if (input.tags) setItemTags(db, item.id, input.tags);
  queueEmbedding(db, item.id);
  return getItem(db, item.id)!;
}

export function captureLink(
  db: DB,
  input: { url: string; title?: string; tags?: string[]; containerId?: number | null; force?: boolean },
): Item {
  const raw = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CaptureError(`Not a valid url: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CaptureError("Only http and https links can be captured");
  }
  if (!input.force) {
    const existing = findLinkByUrl(db, raw);
    if (existing) throw new DuplicateError(existing.id);
  }
  const item = createItem(db, {
    type: "link",
    title: input.title?.trim() || raw,
    sourceUrl: raw,
    containerId: input.containerId ?? null,
  });
  if (input.tags) setItemTags(db, item.id, input.tags);
  enqueueJob(db, "fetch_link", { itemId: item.id }, item.id);
  return getItem(db, item.id)!;
}

export function captureFile(
  db: DB,
  input: { bytes: Buffer; name: string; mime: string; tags?: string[]; containerId?: number | null },
): Item {
  const kind = kindForMime(input.mime, input.name);
  if (kind === "audio") {
    throw new CaptureError("Audio files are captured as meetings, which arrive with the meetings slice", 415);
  }
  const saved = saveFile(input.bytes, input.name);
  const item = createItem(db, {
    type: "file",
    title: input.name,
    filePath: saved.relativePath,
    mimeType: input.mime,
    meta: { kind, size: input.bytes.length },
    containerId: input.containerId ?? null,
  });
  if (input.tags) setItemTags(db, item.id, input.tags);
  if (kind === "pdf") enqueueJob(db, "extract_pdf", { itemId: item.id }, item.id);
  else if (kind === "image") enqueueJob(db, "ocr_image", { itemId: item.id }, item.id);
  else queueEmbedding(db, item.id);
  return getItem(db, item.id)!;
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass. The existing "captures a link and queues fetch_link" test still passes because it uses a different url from the new test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: duplicate link check and capture into containers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 5: People domain

**Files:**
- Create: `src/domain/people/index.ts`
- Modify: `src/domain/items/capture.ts` (auto-link mentions on note capture and content update)
- Test: `src/domain/people/index.test.ts`

**Interfaces:**
- Produces:
  - `createPerson(db, input: { name: string; profile?: string }): Person`, `getPerson(db, id)`, `getPersonBySlug(db, slug)`, `listPeople(db): (Person & { itemCount: number })[]`, `updatePerson(db, id, patch: { name?; profile? }): Person`, `deletePerson(db, id): void`
  - `setItemPeople(db, itemId, personIds: number[]): void`, `addItemPerson(db, itemId, personId): void`, `getItemPeople(db, itemId): Person[]`, `getPersonTimeline(db, personId, includeArchived?): Item[]`
  - `extractMentions(text: string): string[]` and `autoLinkMentions(db, itemId): number` — links `@handle` tokens in the item body to people whose slug or slugified name matches; returns how many links were added
  - `class PersonError extends Error { status }`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/people/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, updateItem } from "@/domain/items";
import { captureNote, updateItemContent } from "@/domain/items/capture";
import {
  createPerson,
  getPerson,
  getPersonBySlug,
  listPeople,
  updatePerson,
  deletePerson,
  setItemPeople,
  addItemPerson,
  getItemPeople,
  getPersonTimeline,
  extractMentions,
  autoLinkMentions,
  PersonError,
} from "./index";

describe("people domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("creates, lists with counts, updates, and deletes people", () => {
    const ada = createPerson(t.db, { name: "Ada Lovelace" });
    expect(ada.slug).toBe("ada-lovelace");
    const ada2 = createPerson(t.db, { name: "Ada Lovelace" });
    expect(ada2.slug).toBe("ada-lovelace-2");
    expect(getPersonBySlug(t.db, "ada-lovelace")?.id).toBe(ada.id);
    const item = createItem(t.db, { type: "note", title: "n" });
    setItemPeople(t.db, item.id, [ada.id]);
    expect(listPeople(t.db).map((p) => [p.slug, p.itemCount])).toEqual([
      ["ada-lovelace", 1],
      ["ada-lovelace-2", 0],
    ]);
    const u = updatePerson(t.db, ada.id, { name: "Countess Ada", profile: "Mathematician" });
    expect(u.slug).toBe("countess-ada");
    expect(getPerson(t.db, ada.id)?.profile).toBe("Mathematician");
    expect(() => updatePerson(t.db, 999, { name: "x" })).toThrow(PersonError);
    deletePerson(t.db, ada2.id);
    expect(listPeople(t.db)).toHaveLength(1);
  });

  it("links items to people and builds a timeline newest first", () => {
    const p = createPerson(t.db, { name: "Grace" });
    const a = createItem(t.db, { type: "note", title: "a" });
    const b = createItem(t.db, { type: "note", title: "b" });
    addItemPerson(t.db, a.id, p.id);
    addItemPerson(t.db, a.id, p.id);
    addItemPerson(t.db, b.id, p.id);
    expect(getItemPeople(t.db, a.id).map((x) => x.id)).toEqual([p.id]);
    expect(getPersonTimeline(t.db, p.id).map((i) => i.id)).toEqual([b.id, a.id]);
    updateItem(t.db, b.id, { archivedAt: new Date().toISOString() });
    expect(getPersonTimeline(t.db, p.id).map((i) => i.id)).toEqual([a.id]);
    expect(getPersonTimeline(t.db, p.id, true)).toHaveLength(2);
    setItemPeople(t.db, a.id, []);
    expect(getItemPeople(t.db, a.id)).toEqual([]);
  });

  it("extracts and auto-links @mentions", () => {
    expect(extractMentions("met @ada-lovelace and @Grace, not email@x.com")).toEqual(["ada-lovelace", "grace"]);
    const ada = createPerson(t.db, { name: "Ada Lovelace" });
    const grace = createPerson(t.db, { name: "Grace Hopper" });
    const note = captureNote(t.db, { body: "Lunch with @ada-lovelace and @grace-hopper about @nobody" });
    expect(getItemPeople(t.db, note.id).map((p) => p.id).sort()).toEqual([ada.id, grace.id].sort());
    const again = autoLinkMentions(t.db, note.id);
    expect(again).toBe(0);
    updateItemContent(t.db, note.id, { body: "Only @grace-hopper now" });
    expect(getItemPeople(t.db, note.id).map((p) => p.id).sort()).toEqual([ada.id, grace.id].sort());
  });
});
```

The last assertion documents that auto-linking only adds links; editing a mention away does not unlink (the user manages removals from the item page).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/people/index.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement**

Create `src/domain/people/index.ts`:

```ts
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, people, itemPeople, type Item, type Person } from "@/db/schema";
import { slugify } from "@/domain/containers";
import { nowIso } from "@/lib/time";

export class PersonError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "PersonError";
  }
}

function uniqueSlug(db: DB, name: string, excludeId?: number): string {
  const base = slugify(name);
  let candidate = base;
  for (let n = 2; ; n++) {
    const existing = db.select({ id: people.id }).from(people).where(eq(people.slug, candidate)).get();
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n}`;
  }
}

export function createPerson(db: DB, input: { name: string; profile?: string }): Person {
  const name = input.name.trim();
  if (!name) throw new PersonError("Name is required");
  const now = nowIso();
  const row = db
    .insert(people)
    .values({ name, slug: uniqueSlug(db, name), profile: input.profile ?? "", createdAt: now, updatedAt: now })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function getPerson(db: DB, id: number): Person | undefined {
  return db.select().from(people).where(eq(people.id, id)).get();
}

export function getPersonBySlug(db: DB, slug: string): Person | undefined {
  return db.select().from(people).where(eq(people.slug, slug)).get();
}

export function listPeople(db: DB): (Person & { itemCount: number })[] {
  const rows = db.select().from(people).orderBy(asc(people.name)).all();
  const counts = db
    .select({ personId: itemPeople.personId, c: sql<number>`count(*)` })
    .from(itemPeople)
    .innerJoin(items, eq(items.id, itemPeople.itemId))
    .where(isNull(items.archivedAt))
    .groupBy(itemPeople.personId)
    .all();
  const byId = new Map(counts.map((c) => [c.personId, Number(c.c)]));
  return rows.map((p) => ({ ...p, itemCount: byId.get(p.id) ?? 0 }));
}

export function updatePerson(db: DB, id: number, patch: { name?: string; profile?: string }): Person {
  const current = getPerson(db, id);
  if (!current) throw new PersonError(`Person ${id} not found`, 404);
  const set: Partial<typeof people.$inferInsert> = { updatedAt: nowIso() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new PersonError("Name is required");
    set.name = name;
    if (name !== current.name) set.slug = uniqueSlug(db, name, id);
  }
  if (patch.profile !== undefined) set.profile = patch.profile;
  const row = db.update(people).set(set).where(eq(people.id, id)).returning().get();
  if (!row) throw new PersonError(`Person ${id} not found`, 404);
  return row;
}

export function deletePerson(db: DB, id: number): void {
  if (!getPerson(db, id)) throw new PersonError(`Person ${id} not found`, 404);
  db.delete(people).where(eq(people.id, id)).run();
}

export function setItemPeople(db: DB, itemId: number, personIds: number[]): void {
  const unique = [...new Set(personIds)];
  db.transaction((tx) => {
    tx.delete(itemPeople).where(eq(itemPeople.itemId, itemId)).run();
    if (unique.length) tx.insert(itemPeople).values(unique.map((personId) => ({ itemId, personId }))).run();
  });
}

export function addItemPerson(db: DB, itemId: number, personId: number): void {
  db.insert(itemPeople).values({ itemId, personId }).onConflictDoNothing().run();
}

export function getItemPeople(db: DB, itemId: number): Person[] {
  return db
    .select({ id: people.id, name: people.name, slug: people.slug, profile: people.profile, createdAt: people.createdAt, updatedAt: people.updatedAt })
    .from(itemPeople)
    .innerJoin(people, eq(people.id, itemPeople.personId))
    .where(eq(itemPeople.itemId, itemId))
    .orderBy(asc(people.name))
    .all();
}

export function getPersonTimeline(db: DB, personId: number, includeArchived = false): Item[] {
  const ids = db
    .select({ itemId: itemPeople.itemId })
    .from(itemPeople)
    .where(eq(itemPeople.personId, personId))
    .all()
    .map((r) => r.itemId);
  if (ids.length === 0) return [];
  const conds = [inArray(items.id, ids)];
  if (!includeArchived) conds.push(isNull(items.archivedAt));
  return db
    .select()
    .from(items)
    .where(and(...conds))
    .orderBy(desc(items.createdAt), desc(items.id))
    .all();
}

const MENTION = /(^|[^\w@.])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** Lowercased handles after `@`, excluding email addresses, in order of first appearance. */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION)) {
    const handle = m[2].toLowerCase().replace(/[.,;:!?]+$/, "");
    if (handle && !out.includes(handle)) out.push(handle);
  }
  return out;
}

/** Link every `@handle` in the item body to a person whose slug matches. Never removes links. */
export function autoLinkMentions(db: DB, itemId: number): number {
  const item = db.select({ body: items.body }).from(items).where(eq(items.id, itemId)).get();
  if (!item) return 0;
  const handles = extractMentions(item.body);
  if (handles.length === 0) return 0;
  const matches = db.select({ id: people.id }).from(people).where(inArray(people.slug, handles)).all();
  const already = new Set(getItemPeople(db, itemId).map((p) => p.id));
  let added = 0;
  for (const m of matches) {
    if (already.has(m.id)) continue;
    addItemPerson(db, itemId, m.id);
    added++;
  }
  return added;
}
```

In `src/domain/items/capture.ts`, add `import { autoLinkMentions } from "@/domain/people";` and call `autoLinkMentions(db, item.id);` in `captureNote` right after `setItemTags` (before `queueEmbedding`), and `autoLinkMentions(db, id);` in `updateItemContent` after the tags update.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: people domain with item links, timeline, and @mention auto-linking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 6: DTOs and API routes for containers, inbox, people, and homes

**Files:**
- Modify: `src/lib/dto.ts`, `src/lib/api.ts`, `src/app/api/items/route.ts`, `src/app/api/items/[id]/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/search/route.ts`
- Create: `src/lib/validation.ts`, `src/app/api/containers/route.ts`, `src/app/api/containers/[id]/route.ts`, `src/app/api/containers/[id]/archive/route.ts`, `src/app/api/containers/[id]/restore/route.ts`, `src/app/api/inbox/route.ts`, `src/app/api/people/route.ts`, `src/app/api/people/[id]/route.ts`
- Test: `src/app/api/para.test.ts`

**Interfaces (HTTP, JSON):**
- `ItemDTO` gains `containerId: number | null`, `archivedAt: string | null`, `container: { id, name, slug, kind } | null`, `people: { id, name, slug }[]`.
- `ContainerDTO`: all container columns plus `itemCount`. `PersonDTO`: id, name, slug, profile, createdAt, updatedAt, `itemCount`.
- `GET /api/containers?kind=&status=` → `ContainerDTO[]`; `POST /api/containers` `{ kind, name, description?, goal?, deadline?, standard?, category?, nextSteps? }` → 201.
- `GET /api/containers/:id` → `ContainerDTO`; `PATCH` (same optional fields plus `sortOrder`) → `ContainerDTO`; `DELETE` → 204 (409 if it has items).
- `POST /api/containers/:id/archive` `{ moveItemsTo?: number | null }` → `ContainerDTO`; `POST /api/containers/:id/restore` → `ContainerDTO`.
- `GET /api/inbox?limit=` → `{ count, items: ItemDTO[] }`.
- `GET /api/people` → `PersonDTO[]`; `POST /api/people` `{ name, profile? }` → 201; `GET /api/people/:id` → `{ person: PersonDTO, timeline: ItemDTO[] }`; `PATCH /api/people/:id` `{ name?, profile? }`; `DELETE` → 204.
- `POST /api/items` accepts `containerId?: number | null` and, for links, `force?: boolean`; a duplicate returns 409 `{ error, existingId }`.
- `GET /api/items` accepts `container=<id>|inbox` and `archived=1`.
- `PATCH /api/items/:id` accepts `containerId: number | null`, `archived: boolean`, `people: number[]` (in addition to title, body, tags).
- `POST /api/upload` accepts a `containerId` form field.
- `GET /api/search` accepts `container=<id>|inbox` and `archived=1`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/para.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import type { ItemDTO, ContainerDTO, PersonDTO } from "@/lib/dto";

let dir: string;
let r: {
  items: typeof import("./items/route");
  item: typeof import("./items/[id]/route");
  containers: typeof import("./containers/route");
  container: typeof import("./containers/[id]/route");
  archive: typeof import("./containers/[id]/archive/route");
  restore: typeof import("./containers/[id]/restore/route");
  inbox: typeof import("./inbox/route");
  people: typeof import("./people/route");
  person: typeof import("./people/[id]/route");
  search: typeof import("./search/route");
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  const { setEmbedProviderForTests } = await import("@/server/providers");
  setEmbedProviderForTests(createFakeEmbedProvider());
  r = {
    items: await import("./items/route"),
    item: await import("./items/[id]/route"),
    containers: await import("./containers/route"),
    container: await import("./containers/[id]/route"),
    archive: await import("./containers/[id]/archive/route"),
    restore: await import("./containers/[id]/restore/route"),
    inbox: await import("./inbox/route"),
    people: await import("./people/route"),
    person: await import("./people/[id]/route"),
    search: await import("./search/route"),
  };
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("containers api", () => {
  it("creates, lists, updates, archives with re-homing, restores, and deletes", async () => {
    const created = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Launch", deadline: "2026-10-01" }));
    expect(created.status).toBe(201);
    const project = (await created.json()) as ContainerDTO;
    expect(project.slug).toBe("launch");
    const areaRes = await r.containers.POST(json("POST", "/api/containers", { kind: "area", name: "Marketing" }));
    const area = (await areaRes.json()) as ContainerDTO;
    expect((await r.containers.POST(json("POST", "/api/containers", { kind: "nope", name: "x" }))).status).toBe(400);

    const list = (await (await r.containers.GET(json("GET", "/api/containers?kind=project"))).json()) as ContainerDTO[];
    expect(list.map((c) => c.id)).toEqual([project.id]);

    const noteRes = await r.items.POST(json("POST", "/api/items", { type: "note", body: "In the project", containerId: project.id }));
    const note = (await noteRes.json()) as ItemDTO;
    expect(note.containerId).toBe(project.id);
    expect(note.container?.slug).toBe("launch");

    const patched = (await (await r.container.PATCH(json("PATCH", `/api/containers/${project.id}`, { goal: "Ship" }), params(project.id))).json()) as ContainerDTO;
    expect(patched.goal).toBe("Ship");
    expect(patched.itemCount).toBe(1);

    const archived = (await (await r.archive.POST(json("POST", `/api/containers/${project.id}/archive`, { moveItemsTo: area.id }), params(project.id))).json()) as ContainerDTO;
    expect(archived.status).toBe("archived");
    const moved = (await (await r.item.GET(json("GET", `/api/items/${note.id}`), params(note.id))).json()) as ItemDTO;
    expect(moved.containerId).toBe(area.id);

    const restored = (await (await r.restore.POST(json("POST", `/api/containers/${project.id}/restore`), params(project.id))).json()) as ContainerDTO;
    expect(restored.status).toBe("active");
    expect((await r.container.DELETE(json("DELETE", `/api/containers/${area.id}`), params(area.id))).status).toBe(409);
    expect((await r.container.DELETE(json("DELETE", `/api/containers/${project.id}`), params(project.id))).status).toBe(204);
    expect((await r.container.GET(json("GET", `/api/containers/${project.id}`), params(project.id))).status).toBe(404);
  });
});

describe("inbox, homes, archive, duplicates", () => {
  it("lists the inbox, files and archives items, and rejects duplicate links", async () => {
    const a = (await (await r.items.POST(json("POST", "/api/items", { type: "note", body: "inbox a" }))).json()) as ItemDTO;
    const inbox = (await (await r.inbox.GET(json("GET", "/api/inbox"))).json()) as { count: number; items: ItemDTO[] };
    expect(inbox.count).toBeGreaterThanOrEqual(1);
    expect(inbox.items.map((i) => i.id)).toContain(a.id);

    const areaRes = await r.containers.POST(json("POST", "/api/containers", { kind: "resource", name: "Reading", category: "articles" }));
    const area = (await areaRes.json()) as ContainerDTO;
    const filed = (await (await r.item.PATCH(json("PATCH", `/api/items/${a.id}`, { containerId: area.id }), params(a.id))).json()) as ItemDTO;
    expect(filed.containerId).toBe(area.id);
    const byContainer = (await (await r.items.GET(json("GET", `/api/items?container=${area.id}`))).json()) as ItemDTO[];
    expect(byContainer.map((i) => i.id)).toEqual([a.id]);
    const onlyInbox = (await (await r.items.GET(json("GET", "/api/items?container=inbox"))).json()) as ItemDTO[];
    expect(onlyInbox.map((i) => i.id)).not.toContain(a.id);

    const archived = (await (await r.item.PATCH(json("PATCH", `/api/items/${a.id}`, { archived: true }), params(a.id))).json()) as ItemDTO;
    expect(archived.archivedAt).toBeTruthy();
    expect(((await (await r.items.GET(json("GET", `/api/items?container=${area.id}`))).json()) as ItemDTO[])).toEqual([]);
    expect(((await (await r.items.GET(json("GET", `/api/items?container=${area.id}&archived=1`))).json()) as ItemDTO[]).map((i) => i.id)).toEqual([a.id]);
    expect((await r.search.GET(json("GET", "/api/search?q=inbox&archived=1"))).status).toBe(200);

    const first = await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup?utm_source=x" }));
    expect(first.status).toBe(201);
    const firstItem = (await first.json()) as ItemDTO;
    const dup = await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup" }));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { existingId: number }).existingId).toBe(firstItem.id);
    expect((await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup", force: true }))).status).toBe(201);
  });
});

describe("people api", () => {
  it("creates people, links them to items, and returns a timeline", async () => {
    const created = await r.people.POST(json("POST", "/api/people", { name: "Ada Lovelace" }));
    expect(created.status).toBe(201);
    const ada = (await created.json()) as PersonDTO;
    const note = (await (await r.items.POST(json("POST", "/api/items", { type: "note", body: "Call with @ada-lovelace" }))).json()) as ItemDTO;
    expect(note.people.map((p) => p.id)).toEqual([ada.id]);
    const detail = (await (await r.person.GET(json("GET", `/api/people/${ada.id}`), params(ada.id))).json()) as { person: PersonDTO; timeline: ItemDTO[] };
    expect(detail.person.itemCount).toBe(1);
    expect(detail.timeline.map((i) => i.id)).toEqual([note.id]);
    const cleared = (await (await r.item.PATCH(json("PATCH", `/api/items/${note.id}`, { people: [] }), params(note.id))).json()) as ItemDTO;
    expect(cleared.people).toEqual([]);
    const list = (await (await r.people.GET()).json()) as PersonDTO[];
    expect(list.map((p) => p.slug)).toContain("ada-lovelace");
    expect((await r.person.DELETE(json("DELETE", `/api/people/${ada.id}`), params(ada.id))).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/api/para.test.ts`
Expected: FAIL, cannot resolve `./containers/route`.

- [ ] **Step 3: DTOs and serializers**

Replace `src/lib/dto.ts`:

```ts
import type { ItemStatus, ItemType, ContainerKind, ContainerStatus, ResourceCategory } from "@/db/enums";

export interface ContainerRefDTO {
  id: number;
  name: string;
  slug: string;
  kind: ContainerKind;
}

export interface PersonRefDTO {
  id: number;
  name: string;
  slug: string;
}

export interface ItemDTO {
  id: number;
  type: ItemType;
  title: string;
  body: string;
  status: ItemStatus;
  error: string | null;
  sourceUrl: string | null;
  filePath: string | null;
  mimeType: string | null;
  extractedText: string;
  meta: Record<string, unknown>;
  tags: string[];
  journalDate: string | null;
  reviewWeek: string | null;
  containerId: number | null;
  container: ContainerRefDTO | null;
  archivedAt: string | null;
  people: PersonRefDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultDTO {
  item: ItemDTO;
  snippet: string;
  score: number;
  chunkId: number;
}

export interface ContainerDTO {
  id: number;
  kind: ContainerKind;
  name: string;
  slug: string;
  description: string;
  status: ContainerStatus;
  goal: string;
  deadline: string | null;
  standard: string;
  category: ResourceCategory | null;
  nextSteps: string;
  sortOrder: number;
  archivedAt: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDTO {
  id: number;
  name: string;
  slug: string;
  profile: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}
```

Replace `src/lib/api.ts`:

```ts
import { NextResponse } from "next/server";
import type { DB } from "@/db/client";
import type { Item, Container, Person } from "@/db/schema";
import { getItemTags, parseMeta } from "@/domain/items";
import { CaptureError, DuplicateError } from "@/domain/items/capture";
import { getContainer, countContainerItems, ContainerError } from "@/domain/containers";
import { getItemPeople, PersonError } from "@/domain/people";
import type { ItemDTO, ContainerDTO, PersonDTO } from "./dto";

export function serializeItem(db: DB, item: Item): ItemDTO {
  const container = item.containerId ? getContainer(db, item.containerId) : undefined;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    status: item.status,
    error: item.error,
    sourceUrl: item.sourceUrl,
    filePath: item.filePath,
    mimeType: item.mimeType,
    extractedText: item.extractedText,
    meta: parseMeta(item),
    tags: getItemTags(db, item.id),
    journalDate: item.journalDate,
    reviewWeek: item.reviewWeek,
    containerId: item.containerId,
    container: container ? { id: container.id, name: container.name, slug: container.slug, kind: container.kind } : null,
    archivedAt: item.archivedAt,
    people: getItemPeople(db, item.id).map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function serializeContainer(db: DB, c: Container): ContainerDTO {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    description: c.description,
    status: c.status,
    goal: c.goal,
    deadline: c.deadline,
    standard: c.standard,
    category: c.category,
    nextSteps: c.nextSteps,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
    itemCount: countContainerItems(db, c.id),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export function serializePerson(p: Person & { itemCount?: number }, itemCount?: number): PersonDTO {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    profile: p.profile,
    itemCount: itemCount ?? p.itemCount ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof DuplicateError) {
    return NextResponse.json({ error: err.message, existingId: err.existingId }, { status: err.status });
  }
  if (err instanceof CaptureError || err instanceof ContainerError || err instanceof PersonError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse a positive integer route param. Throws CaptureError(400) otherwise. */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new CaptureError(`Invalid id: ${raw}`, 400);
  return id;
}

/** `container=<id>` → id, `container=inbox` → null, absent → undefined. Throws CaptureError(400) on garbage. */
export function parseContainerParam(raw: string | null): number | null | undefined {
  if (raw === null || raw === "") return undefined;
  if (raw === "inbox") return null;
  return parseId(raw);
}
```

- [ ] **Step 4: Container, inbox, and people routes**

Next.js only allows handler exports (`GET`, `POST`, `dynamic`, ...) from route files, so shared zod schemas live in a lib module. Create `src/lib/validation.ts`:

```ts
import { z } from "zod";
import { CONTAINER_KINDS, RESOURCE_CATEGORIES } from "@/db/enums";

export const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ContainerBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  goal: z.string().optional(),
  deadline: DateString.nullable().optional(),
  standard: z.string().optional(),
  category: z.enum(RESOURCE_CATEGORIES).nullable().optional(),
  nextSteps: z.string().optional(),
});

export const CreateContainerBody = ContainerBody.extend({ kind: z.enum(CONTAINER_KINDS) });
export const PatchContainerBody = ContainerBody.partial().extend({ sortOrder: z.number().int().optional() });
```

Create `src/app/api/containers/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { CONTAINER_KINDS, CONTAINER_STATUSES } from "@/db/enums";
import { createContainer, listContainers } from "@/domain/containers";
import { errorResponse, serializeContainer } from "@/lib/api";
import { CreateContainerBody as CreateBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const c = createContainer(db, parsed.data);
    return NextResponse.json(serializeContainer(db, c), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

const ListParams = z.object({
  kind: z.enum(CONTAINER_KINDS).optional(),
  status: z.enum(CONTAINER_STATUSES).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parsed = ListParams.safeParse({
      kind: url.searchParams.get("kind") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(listContainers(db, parsed.data).map((c) => serializeContainer(db, c)));
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/containers/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { deleteContainer, getContainer, updateContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";
import { PatchContainerBody as PatchBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const c = getContainer(db, id);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(serializeContainer(db, c));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(serializeContainer(db, updateContainer(db, id, parsed.data)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    deleteContainer(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/containers/[id]/archive/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { archiveContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ moveItemsTo: z.number().int().positive().nullable().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const raw = await req.text();
    const parsed = Body.safeParse(raw ? JSON.parse(raw) : {});
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(serializeContainer(db, archiveContainer(db, id, parsed.data)));
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/containers/[id]/restore/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { restoreContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    return NextResponse.json(serializeContainer(db, restoreContainer(db, id)));
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/inbox/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { countInbox, listItems } from "@/domain/items";
import { errorResponse, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
    const db = getDb();
    const items = listItems(db, { containerId: null, limit }).map((i) => serializeItem(db, i));
    return NextResponse.json({ count: countInbox(db), items });
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/people/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createPerson, listPeople } from "@/domain/people";
import { errorResponse, serializePerson } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().min(1), profile: z.string().optional() });

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listPeople(getDb()).map((p) => serializePerson(p)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const p = createPerson(getDb(), parsed.data);
    return NextResponse.json(serializePerson(p, 0), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

Create `src/app/api/people/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deletePerson, getPerson, getPersonTimeline, updatePerson } from "@/domain/people";
import { errorResponse, parseId, serializeItem, serializePerson } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const PatchBody = z.object({ name: z.string().min(1).optional(), profile: z.string().optional() });

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    const db = getDb();
    const person = getPerson(db, id);
    if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const timeline = getPersonTimeline(db, id, includeArchived);
    return NextResponse.json({
      person: serializePerson(person, getPersonTimeline(db, id).length),
      timeline: timeline.map((i) => serializeItem(db, i)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const p = updatePerson(db, id, parsed.data);
    return NextResponse.json(serializePerson(p, getPersonTimeline(db, id).length));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    deletePerson(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: Extend the existing routes**

`src/app/api/items/route.ts`: add `containerId: z.number().int().positive().nullable().optional()` to both `NoteBody` and `LinkBody`, and `force: z.boolean().optional()` to `LinkBody`. In `GET`, import `parseContainerParam` and pass `containerId: parseContainerParam(url.searchParams.get("container"))` and `includeArchived: url.searchParams.get("archived") === "1"` into `listItems`.

`src/app/api/items/[id]/route.ts`: extend `PatchBody` with `containerId: z.number().int().positive().nullable().optional()`, `archived: z.boolean().optional()`, `people: z.array(z.number().int().positive()).optional()`. In `PATCH`, after validation:

```ts
    const { containerId, archived, people: personIds, ...content } = parsed.data;
    const db = getDb();
    if (!getItem(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (content.title !== undefined || content.body !== undefined || content.tags !== undefined) updateItemContent(db, id, content);
    if (containerId !== undefined) fileItem(db, id, containerId);
    if (archived === true) archiveItem(db, id);
    if (archived === false) restoreItem(db, id);
    if (personIds !== undefined) setItemPeople(db, id, personIds);
    return NextResponse.json(serializeItem(db, getItem(db, id)!));
```

with `fileItem, archiveItem, restoreItem, getItem` imported from `@/domain/items` and `setItemPeople` from `@/domain/people`. `fileItem` throws a plain Error for an unknown container; wrap that case: catch errors whose message matches `/not found/` and return 400 (`if (err instanceof Error && /not found/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });` before `return errorResponse(err)`).

`src/app/api/upload/route.ts`: read `const containerRaw = form.get("containerId");` and pass `containerId: typeof containerRaw === "string" && containerRaw ? parseId(containerRaw) : null` to `captureFile` (import `parseId`).

`src/app/api/search/route.ts`: add `container: z.string().optional()` and `archived: z.string().optional()` to `Query`; after parsing, build the filter as `{ ...filter, containerId: parseContainerParam(parsed.data.container ?? null), includeArchived: parsed.data.archived === "1" }` where `filter` excludes `container` and `archived` (destructure them out alongside `q` and `limit`).

- [ ] **Step 6: Run the tests and the build**

Run: `npm test` then `npm run build`
Expected: all pass (the foundation `api.test.ts` still passes: its DTO assertions only check fields that still exist), build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): containers, inbox, people, item homes, archive, and duplicate responses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 7: Floating dock replaces the sidebar

**Files:**
- Create: `src/components/nav.ts`, `src/components/icons.tsx`, `src/components/dock.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/shortcuts.tsx`, `src/components/command-palette.tsx`
- Delete: `src/components/sidebar.tsx`
- Placeholder pages so every dock link resolves: `src/app/inbox/page.tsx`, `src/app/projects/page.tsx`, `src/app/areas/page.tsx`, `src/app/resources/page.tsx`, `src/app/people/page.tsx`, `src/app/archive/page.tsx` (each a one-line placeholder replaced in Tasks 8 to 10)

**Interfaces:**
- Produces: `NAV_ITEMS: NavItem[]` and `type NavItem = { href; label; shortcut; icon: IconName; badge?: "inbox" }` from `@/components/nav`; `Icon({ name, className })` from `@/components/icons`; `Dock()`; the palette also opens on a `window` event named `sb:palette`.

- [ ] **Step 1: Write the manifest and icons**

Create `src/components/nav.ts`:

```ts
export type IconName = "inbox" | "project" | "area" | "resource" | "people" | "library" | "archive" | "search" | "capture";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: IconName;
  badge?: "inbox";
}

/** Order is the dock order. Every entry has a `g` + letter shortcut. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", shortcut: "g i", icon: "inbox", badge: "inbox" },
  { href: "/projects", label: "Projects", shortcut: "g p", icon: "project" },
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource" },
  { href: "/people", label: "People", shortcut: "g e", icon: "people" },
  { href: "/library", label: "Library", shortcut: "g l", icon: "library" },
  { href: "/archive", label: "Archive", shortcut: "g x", icon: "archive" },
  { href: "/search", label: "Search", shortcut: "g s", icon: "search" },
  { href: "/capture", label: "Capture", shortcut: "g c", icon: "capture" },
];
```

Create `src/components/icons.tsx`:

```tsx
import type { IconName } from "./nav";

const PATHS: Record<IconName, string> = {
  inbox: "M3 13l2-8h14l2 8v6H3z M3 13h5l1 2h6l1-2h5",
  project: "M5 21V4h11l-1 4 1 4H5",
  area: "M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5",
  resource: "M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4z M20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z",
  people: "M16 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2 M9.5 11a4 4 0 100-8 4 4 0 000 8z M21 21v-2a4 4 0 00-3-3.9 M15 3.1a4 4 0 010 7.8",
  library: "M4 6h16 M4 12h16 M4 18h10",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-4.3-4.3",
  capture: "M12 5v14 M5 12h14",
};

export function Icon({ name, className = "w-[18px] h-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
```

- [ ] **Step 2: Write the dock**

Create `src/components/dock.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav";
import { Icon } from "./icons";

const POLL_MS = 20_000;

export function Dock() {
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox?limit=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setInboxCount(data.count);
      } catch {
        /* offline */
      }
    }
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pathname]);

  return (
    <nav aria-label="Main" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <ul className="flex items-center gap-0.5 px-2 py-1.5 rounded-2xl bg-surface-2/90 backdrop-blur-md border border-line-strong shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.badge === "inbox" ? inboxCount : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                className={`group relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-150 hover:-translate-y-0.5 ${
                  active ? "text-accent bg-accent-dim" : "text-fg-muted hover:text-fg hover:bg-surface-3"
                }`}
              >
                <Icon name={item.icon} />
                {count > 0 && (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-bg font-mono text-[10px] leading-4 text-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-[11px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0">
                  {item.label} <span className="kbd ml-1">{item.shortcut}</span>
                </span>
              </Link>
            </li>
          );
        })}
        <li className="w-px h-6 bg-line mx-1" aria-hidden />
        <li>
          <button
            type="button"
            aria-label="Command palette"
            onClick={() => window.dispatchEvent(new Event("sb:palette"))}
            className="group relative flex items-center justify-center h-11 px-2 rounded-xl font-mono text-[11px] text-fg-faint hover:text-fg hover:bg-surface-3 transition-colors duration-150"
          >
            ⌘K
          </button>
        </li>
      </ul>
    </nav>
  );
}
```

- [ ] **Step 3: Rewire layout, shortcuts, palette, root redirect**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Dock } from "@/components/dock";
import { CommandPalette } from "@/components/command-palette";
import { Shortcuts } from "@/components/shortcuts";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Personal capture, search, tasks, and meetings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-bg text-fg">
        <main className="min-h-screen pb-28">{children}</main>
        <Dock />
        <CommandPalette />
        <Shortcuts />
      </body>
    </html>
  );
}
```

In `src/app/page.tsx` change the redirect target to `/inbox`.

In `src/components/shortcuts.tsx` and `src/components/command-palette.tsx`, change `import { NAV_ITEMS } from "./sidebar";` to `import { NAV_ITEMS } from "./nav";` and remove every `.filter((n) => n.enabled)` (the manifest has no `enabled` field). In the palette, extend the keydown effect so the dock button can open it: add inside the same `useEffect`, after `window.addEventListener("keydown", onKey);`:

```ts
    function onOpen() {
      setOpen(true);
      setQuery("");
      setIndex(0);
    }
    window.addEventListener("sb:palette", onOpen);
```

and in the cleanup `window.removeEventListener("sb:palette", onOpen);`.

Delete `src/components/sidebar.tsx`. Create the six placeholder pages, each like:

```tsx
export default function InboxPage() {
  return <div className="p-6 text-fg-muted">Inbox arrives in Task 8.</div>;
}
```

(with the matching name and task number: Projects, Areas, Resources in Task 9; People in Task 10; Archive in Task 9).

- [ ] **Step 4: Build and check**

Run: `npm test && npm run build`
Expected: pass and build succeeds. Run `npm run dev &`, `sleep 8`, `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3141/inbox` → `200`, then in a browser: the dock floats at the bottom centre with hover labels, the inbox badge shows a count, `g p` navigates to Projects, ⌘K and the dock's ⌘K button open the palette. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): floating dock with inbox badge replaces the sidebar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 8: Container picker and the Inbox processing flow

**Files:**
- Create: `src/components/container-picker.tsx`, `src/components/inbox-processor.tsx`
- Modify: `src/app/inbox/page.tsx`

**Interfaces:**
- Produces: `ContainerPicker({ kind?, allowInbox?, title?, onPick(c: ContainerDTO | null), onClose })` — a modal list of active containers (filtered to `kind` when given) with type-to-filter, arrow keys, Enter, and "create new" when the typed name matches nothing and `kind` is set; `onPick(null)` means Inbox. `InboxProcessor()`.

- [ ] **Step 1: Write the picker**

Create `src/components/container-picker.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContainerDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";

interface Props {
  kind?: ContainerKind;
  allowInbox?: boolean;
  title?: string;
  onPick: (container: ContainerDTO | null) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<ContainerKind, string> = { project: "Project", area: "Area", resource: "Resource" };

export function ContainerPicker({ kind, allowInbox = false, title, onPick, onClose }: Props) {
  const [all, setAll] = useState<ContainerDTO[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/containers?status=active")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ContainerDTO[]) => {
        if (!cancelled) setAll(list);
      })
      .catch(() => {});
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const options = useMemo(() => {
    const pool = kind ? all.filter((c) => c.kind === kind) : all;
    return q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  }, [all, kind, q]);
  const exact = options.some((c) => c.name.toLowerCase() === q);
  const canCreate = Boolean(kind && q && !exact);
  const rows: Array<{ key: string; label: string; hint: string; run: () => void }> = [];
  if (allowInbox && !q) rows.push({ key: "inbox", label: "Inbox", hint: "unfiled", run: () => onPick(null) });
  for (const c of options) rows.push({ key: String(c.id), label: c.name, hint: KIND_LABEL[c.kind], run: () => onPick(c) });
  if (canCreate) rows.push({ key: "new", label: `Create ${KIND_LABEL[kind!].toLowerCase()} “${query.trim()}”`, hint: "new", run: () => void create() });

  async function create() {
    if (!kind || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: query.trim() }),
      });
      if (res.ok) onPick((await res.json()) as ContainerDTO);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[18vh]" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 h-8 flex items-center font-mono text-[10px] tracking-wider uppercase text-fg-faint border-b border-line">
          {title ?? (kind ? `File to ${KIND_LABEL[kind].toLowerCase()}` : "Move to")}
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && rows[index]) {
              e.preventDefault();
              rows[index].run();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder={kind ? "Type to filter or create" : "Type to filter"}
          className="w-full h-11 px-4 bg-transparent border-b border-line outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {rows.length === 0 && <li className="px-4 py-2 text-fg-faint">Nothing here yet</li>}
          {rows.map((r, i) => (
            <li
              key={r.key}
              onMouseEnter={() => setIndex(i)}
              onClick={r.run}
              className={`px-4 h-9 flex items-center justify-between cursor-pointer ${i === index ? "bg-surface-3 text-fg" : "text-fg-muted"}`}
            >
              <span className="truncate">{r.label}</span>
              <span className="font-mono text-[10px] text-fg-faint">{r.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the processor and page**

Create `src/components/inbox-processor.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ContainerDTO, ItemDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";
import { StatusBadge, TypeBadge } from "./badges";
import { relativeTime } from "@/lib/format";
import { ContainerPicker } from "./container-picker";

type Mode = "focus" | "list";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function InboxProcessor() {
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("focus");
  const [picker, setPicker] = useState<ContainerKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      const data = (await res.json()) as { count: number; items: ItemDTO[] };
      setItems(data.items);
      setTotal(data.count);
      setIndex((i) => Math.min(i, Math.max(0, data.items.length - 1)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = items[index];

  function removeCurrent() {
    setItems((all) => all.filter((_, i) => i !== index));
    setTotal((t) => Math.max(0, t - 1));
    setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    setConfirmDelete(false);
  }

  async function patch(body: Record<string, unknown>) {
    if (!current) return;
    setError(null);
    const res = await fetch(`/api/items/${current.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      return;
    }
    removeCurrent();
  }

  async function remove() {
    if (!current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/items/${current.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Delete failed");
      return;
    }
    removeCurrent();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (picker || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "p":
        case "a":
        case "r":
          if (!current) return;
          e.preventDefault();
          setPicker(e.key === "p" ? "project" : e.key === "a" ? "area" : "resource");
          break;
        case "e":
          e.preventDefault();
          void patch({ archived: true });
          break;
        case "x":
          e.preventDefault();
          void remove();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, items.length - 1));
          setConfirmDelete(false);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          setConfirmDelete(false);
          break;
        case "l":
          e.preventDefault();
          setMode((m) => (m === "focus" ? "list" : "focus"));
          break;
        case "Escape":
          setConfirmDelete(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, current, items.length, confirmDelete]);

  const preview = current ? (current.body || current.extractedText).replace(/\s+/g, " ").trim().slice(0, 600) : "";

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Inbox</h1>
        <span className="font-mono text-[10px] text-fg-faint">
          {loaded ? (items.length ? `${index + 1} of ${total}` : "inbox zero") : "loading"} · <button onClick={() => setMode((m) => (m === "focus" ? "list" : "focus"))} className="hover:text-fg">{mode === "focus" ? "list (l)" : "focus (l)"}</button>
        </span>
      </header>

      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}

      {loaded && items.length === 0 && (
        <div className="rounded-lg border border-line bg-surface-1 p-8 text-center">
          <div className="text-fg">Nothing waiting.</div>
          <Link href="/capture" className="mt-2 inline-block text-[12px] text-accent hover:underline">
            Capture something
          </Link>
        </div>
      )}

      {mode === "list" && items.length > 0 && (
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.map((item, i) => (
            <li
              key={item.id}
              onClick={() => {
                setIndex(i);
                setMode("focus");
              }}
              className={`flex items-center gap-3 px-3 h-9 cursor-pointer ${i === index ? "bg-surface-3" : "hover:bg-surface-2"}`}
            >
              <TypeBadge type={item.type} />
              <span className="flex-1 truncate text-[13px]">{item.title}</span>
              <span className="font-mono text-[10px] text-fg-faint">{relativeTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {mode === "focus" && current && (
        <section className="rounded-lg border border-line bg-surface-1">
          <div className="flex items-center gap-3 px-4 h-10 border-b border-line">
            <TypeBadge type={current.type} />
            <Link href={`/items/${current.id}`} className="flex-1 truncate text-[13.5px] font-medium hover:text-accent">
              {current.title}
            </Link>
            <StatusBadge status={current.status} error={current.error} />
            <span className="font-mono text-[10px] text-fg-faint">{relativeTime(current.createdAt)}</span>
          </div>
          <div className="px-4 py-3 text-[13px] leading-relaxed text-fg-muted min-h-24">
            {current.sourceUrl && (
              <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="block font-mono text-[11px] text-accent truncate mb-2">
                {current.sourceUrl}
              </a>
            )}
            {preview || <span className="text-fg-faint">No text yet.</span>}
          </div>
          {(current.tags.length > 0 || current.people.length > 0) && (
            <div className="px-4 pb-3 flex flex-wrap gap-2 font-mono text-[10px] text-fg-faint">
              {current.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {current.people.map((p) => (
                <span key={p.id}>@{p.slug}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 h-12 border-t border-line">
            {(
              [
                ["p", "Project", () => setPicker("project")],
                ["a", "Area", () => setPicker("area")],
                ["r", "Resource", () => setPicker("resource")],
                ["e", "Archive", () => void patch({ archived: true })],
              ] as const
            ).map(([key, label, run]) => (
              <button key={key} onClick={run} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong flex items-center gap-2">
                <span className="kbd">{key}</span>
                {label}
              </button>
            ))}
            <button
              onClick={() => void remove()}
              className={`h-7 px-2 rounded-md text-[12px] border flex items-center gap-2 ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}
            >
              <span className="kbd">x</span>
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
            <span className="flex-1" />
            <span className="font-mono text-[10px] text-fg-faint">j / k to move</span>
          </div>
        </section>
      )}

      {picker && (
        <ContainerPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onPick={(c) => {
            setPicker(null);
            void patch({ containerId: c ? c.id : null });
          }}
        />
      )}
    </div>
  );
}
```

The `eslint-disable-next-line react-hooks/exhaustive-deps` above suppresses the rule for `patch` and `remove`, which are recreated each render; if the project's lint config rejects the disable, convert `patch` and `remove` to `useCallback` with `[current, index, items.length, confirmDelete]` deps and list them in the effect instead. Report which you did.

Replace `src/app/inbox/page.tsx`:

```tsx
import { InboxProcessor } from "@/components/inbox-processor";

export default function InboxPage() {
  return <InboxProcessor />;
}
```

- [ ] **Step 3: Build and check**

Run: `npm test && npm run build`. Then with the dev server: capture two notes and a link, open `/inbox`, confirm `1 of 3`, press `p`, type a new project name, Enter (creates and files), confirm the counter drops and the dock badge updates within 20 s or on navigation, press `e` on the next item, then `x` twice on the last. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): inbox processing flow with container picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 9: Projects, Areas, Resources, container pages, and Archive

**Files:**
- Create: `src/components/container-list.tsx`, `src/components/new-container-form.tsx`, `src/components/container-editor.tsx`, `src/components/complete-project-dialog.tsx`, `src/components/restore-button.tsx`, `src/app/c/[slug]/page.tsx`
- Modify: `src/app/projects/page.tsx`, `src/app/areas/page.tsx`, `src/app/resources/page.tsx`, `src/app/archive/page.tsx`

**Interfaces:**
- Produces: server pages `/projects`, `/areas`, `/resources` (resources grouped by category), `/c/[slug]` (container page), `/archive`; client components `NewContainerForm({ kind })`, `ContainerEditor({ initial: ContainerDTO, items: ItemDTO[] })`, `CompleteProjectDialog`, `RestoreButton({ kind: "container" | "item", id })`.

- [ ] **Step 1: List pages and the new-container form**

Create `src/components/new-container-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContainerKind } from "@/db/enums";

export function NewContainerForm({ kind }: { kind: ContainerKind }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex items-center gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`New ${kind}`}
        className="h-8 flex-1 max-w-sm bg-surface-1 border border-line rounded-md px-3 text-[13px] outline-none focus:border-accent"
      />
      <button type="submit" disabled={!name.trim() || busy} className="h-8 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">
        Add
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </form>
  );
}
```

Create `src/components/container-list.tsx` (a server-safe component, no hooks):

```tsx
import Link from "next/link";
import type { ContainerDTO } from "@/lib/dto";
import { formatDate } from "@/lib/format";

export function ContainerList({ containers, emptyText }: { containers: ContainerDTO[]; emptyText: string }) {
  if (containers.length === 0) return <div className="px-3 h-12 flex items-center text-fg-faint text-[13px] border border-line rounded-lg bg-surface-1">{emptyText}</div>;
  return (
    <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
      {containers.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-3 h-11 hover:bg-surface-2 transition-colors duration-150">
          <Link href={`/c/${c.slug}`} className="flex-1 min-w-0">
            <div className="truncate text-[13.5px]">{c.name}</div>
            {(c.goal || c.standard || c.description) && (
              <div className="truncate text-[11.5px] text-fg-muted">{c.goal || c.standard || c.description}</div>
            )}
          </Link>
          {c.kind === "project" && c.deadline && (
            <span className={`font-mono text-[10px] ${c.deadline < new Date().toISOString().slice(0, 10) ? "text-danger" : "text-fg-muted"}`}>
              due {formatDate(`${c.deadline}T00:00:00`)}
            </span>
          )}
          <span className="font-mono text-[10px] text-fg-faint w-14 text-right">{c.itemCount} items</span>
        </li>
      ))}
    </ul>
  );
}
```

Replace `src/app/projects/page.tsx`:

```tsx
import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const db = getDb();
  const projects = listContainers(db, { kind: "project", status: "active" }).map((c) => serializeContainer(db, c));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Projects</h1>
        <span className="font-mono text-[10px] text-fg-faint">outcomes with a deadline · {projects.length} active</span>
      </header>
      <NewContainerForm kind="project" />
      <ContainerList containers={projects} emptyText="No projects yet. A project is an outcome with a deadline." />
    </div>
  );
}
```

Replace `src/app/areas/page.tsx` the same way with `kind: "area"`, title "Areas", subtitle "responsibilities with a standard", empty text "No areas yet. An area is something you maintain, not finish."

Replace `src/app/resources/page.tsx`, grouping by category:

```tsx
import { getDb } from "@/db/client";
import { RESOURCE_CATEGORIES } from "@/db/enums";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";

export const dynamic = "force-dynamic";

export default function ResourcesPage() {
  const db = getDb();
  const resources = listContainers(db, { kind: "resource", status: "active" }).map((c) => serializeContainer(db, c));
  const groups = RESOURCE_CATEGORIES.map((cat) => ({ cat, list: resources.filter((r) => (r.category ?? "other") === cat) })).filter((g) => g.list.length > 0);
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Resources</h1>
        <span className="font-mono text-[10px] text-fg-faint">topics of interest · {resources.length} active</span>
      </header>
      <NewContainerForm kind="resource" />
      {groups.length === 0 && <ContainerList containers={[]} emptyText="No resources yet. A resource is a topic you keep collecting on." />}
      {groups.map((g) => (
        <section key={g.cat} className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">{g.cat}</h2>
          <ContainerList containers={g.list} emptyText="" />
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Container page, editor, complete dialog**

Create `src/components/complete-project-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ContainerDTO } from "@/lib/dto";
import { ContainerPicker } from "./container-picker";

interface Props {
  container: ContainerDTO;
  onDone: () => void;
  onClose: () => void;
}

/** Archive a project; its items either go with it or move to an area or resource. */
export function CompleteProjectDialog({ container, onDone, onClose }: Props) {
  const [picker, setPicker] = useState<"area" | "resource" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(moveItemsTo?: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/containers/${container.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(moveItemsTo === undefined ? {} : { moveItemsTo }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (picker) {
    return (
      <ContainerPicker
        kind={picker}
        title={`Move ${container.itemCount} items to ${picker}`}
        onClose={() => setPicker(null)}
        onPick={(c) => {
          setPicker(null);
          if (c) void archive(c.id);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-medium">Complete “{container.name}”</h2>
        <p className="text-[13px] text-fg-muted">
          The project is archived. What happens to its {container.itemCount} items?
        </p>
        <button disabled={busy} onClick={() => void archive()} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Archive them with the project
        </button>
        <button disabled={busy} onClick={() => setPicker("area")} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Move them to an area
        </button>
        <button disabled={busy} onClick={() => setPicker("resource")} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Move them to a resource
        </button>
        <button disabled={busy} onClick={() => void archive(null)} className="h-9 rounded-md border border-line hover:border-line-strong text-[13px] text-left px-3">
          Send them back to the Inbox
        </button>
        {error && <div className="text-[12px] text-danger">{error}</div>}
        <button onClick={onClose} className="self-end text-[12px] text-fg-muted hover:text-fg">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

Create `src/components/container-editor.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ContainerDTO, ItemDTO } from "@/lib/dto";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/db/enums";
import { StatusBadge, TypeBadge } from "./badges";
import { relativeTime } from "@/lib/format";
import { CompleteProjectDialog } from "./complete-project-dialog";

const KIND_LABEL = { project: "Project", area: "Area", resource: "Resource" } as const;

export function ContainerEditor({ initial, items }: { initial: ContainerDTO; items: ItemDTO[] }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [goal, setGoal] = useState(initial.goal);
  const [deadline, setDeadline] = useState(initial.deadline ?? "");
  const [standard, setStandard] = useState(initial.standard);
  const [category, setCategory] = useState<ResourceCategory>(initial.category ?? "other");
  const [nextSteps, setNextSteps] = useState(initial.nextSteps);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, description, nextSteps };
      if (c.kind === "project") Object.assign(body, { goal, deadline: deadline || null });
      if (c.kind === "area") body.standard = standard;
      if (c.kind === "resource") body.category = category;
      const res = await fetch(`/api/containers/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      const updated = (await res.json()) as ContainerDTO;
      setC(updated);
      setDirty(false);
      if (updated.slug !== c.slug) router.replace(`/c/${updated.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, goal, deadline, standard, category, nextSteps, c.id, c.kind, saving]);

  async function archiveOrRestore() {
    setError(null);
    const url = c.status === "archived" ? `/api/containers/${c.id}/restore` : `/api/containers/${c.id}/archive`;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      return;
    }
    setC((await res.json()) as ContainerDTO);
    router.refresh();
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/containers/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      setConfirmDelete(false);
      return;
    }
    router.push(`/${c.kind}s`);
  }

  const field = "w-full bg-surface-1 border border-line rounded-md px-3 py-2 text-[13px] outline-none focus:border-accent";
  const mark = () => setDirty(true);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-center gap-3 h-8">
        <Link href={`/${c.kind}s`} className="font-mono text-[11px] text-fg-muted hover:text-fg">
          ← {KIND_LABEL[c.kind].toLowerCase()}s
        </Link>
        <span className="font-mono text-[10px] tracking-wider uppercase text-fg-muted border border-line rounded-sm px-1.5 py-0.5">{KIND_LABEL[c.kind]}</span>
        {c.status === "archived" && <span className="font-mono text-[10px] text-warn">archived</span>}
        <span className={`font-mono text-[10px] ${error ? "text-danger" : "text-fg-faint"}`}>{saving ? "saving" : dirty ? "unsaved · ⌘S" : ""}</span>
        <span className="flex-1" />
        <Link href={`/capture?to=${c.slug}`} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong flex items-center">
          Capture here
        </Link>
        {c.status === "active" && c.kind === "project" && (
          <button onClick={() => setComplete(true)} className="h-7 px-2 rounded-md text-[12px] border border-accent text-accent">
            Complete
          </button>
        )}
        {(c.status === "archived" || c.kind !== "project") && (
          <button onClick={() => void archiveOrRestore()} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong">
            {c.status === "archived" ? "Restore" : "Archive"}
          </button>
        )}
        {c.itemCount === 0 && (
          <button onClick={() => void remove()} onBlur={() => setConfirmDelete(false)} className={`h-7 px-2 rounded-md text-[12px] border ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}>
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        )}
        <button onClick={() => void save()} disabled={!dirty || saving} className="h-7 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">
          Save
        </button>
      </header>

      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}

      <input value={name} onChange={(e) => { setName(e.target.value); mark(); }} className="w-full bg-transparent outline-none text-2xl font-medium tracking-tight" placeholder="Name" />

      {c.kind === "project" && (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <input value={goal} onChange={(e) => { setGoal(e.target.value); mark(); }} placeholder="Goal: what does done look like?" className={field} />
          <input type="date" value={deadline} onChange={(e) => { setDeadline(e.target.value); mark(); }} className={`${field} font-mono text-[12px]`} />
        </div>
      )}
      {c.kind === "area" && (
        <input value={standard} onChange={(e) => { setStandard(e.target.value); mark(); }} placeholder="Standard: what does good look like here?" className={field} />
      )}
      {c.kind === "resource" && (
        <select value={category} onChange={(e) => { setCategory(e.target.value as ResourceCategory); mark(); }} className={`${field} max-w-xs font-mono text-[12px]`}>
          {RESOURCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      )}

      <textarea value={description} onChange={(e) => { setDescription(e.target.value); mark(); }} placeholder="Description" rows={3} className={`${field} resize-y`} />

      {c.kind === "project" && (
        <section className="flex flex-col gap-1">
          <label className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Next steps</label>
          <textarea value={nextSteps} onChange={(e) => { setNextSteps(e.target.value); mark(); }} placeholder={"- [ ] first step"} rows={4} className={`${field} resize-y font-mono text-[12.5px]`} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Items · {items.length}</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">Nothing filed here yet.</li>}
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 h-9 hover:bg-surface-2 transition-colors duration-150">
              <TypeBadge type={item.type} />
              <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{item.title}</Link>
              <StatusBadge status={item.status} error={item.error} />
              <span className="font-mono text-[10px] text-fg-faint">{relativeTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      {complete && (
        <CompleteProjectDialog
          container={c}
          onClose={() => setComplete(false)}
          onDone={() => {
            setComplete(false);
            router.push("/projects");
          }}
        />
      )}
    </div>
  );
}
```

Create `src/app/c/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getContainerBySlug } from "@/domain/containers";
import { listItems } from "@/domain/items";
import { serializeContainer, serializeItem } from "@/lib/api";
import { ContainerEditor } from "@/components/container-editor";

export const dynamic = "force-dynamic";

export default async function ContainerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const c = getContainerBySlug(db, slug);
  if (!c) notFound();
  const items = listItems(db, { containerId: c.id, includeArchived: c.status === "archived", limit: 500 }).map((i) => serializeItem(db, i));
  return <ContainerEditor key={c.id} initial={serializeContainer(db, c)} items={items} />;
}
```

- [ ] **Step 3: Archive page and restore button**

Create `src/components/restore-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RestoreButton({ kind, id }: { kind: "container" | "item"; id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    try {
      const res =
        kind === "container"
          ? await fetch(`/api/containers/${id}/restore`, { method: "POST" })
          : await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: false }) });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={() => void restore()} disabled={busy} className="h-6 px-2 rounded-sm font-mono text-[10px] uppercase tracking-wider border border-line hover:border-accent hover:text-accent disabled:opacity-40">
      restore
    </button>
  );
}
```

Replace `src/app/archive/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { listItems } from "@/domain/items";
import { serializeContainer, serializeItem } from "@/lib/api";
import { TypeBadge } from "@/components/badges";
import { RestoreButton } from "@/components/restore-button";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  const db = getDb();
  const containers = listContainers(db, { status: "archived" }).map((c) => serializeContainer(db, c));
  const items = listItems(db, { includeArchived: true, limit: 500 })
    .filter((i) => i.archivedAt)
    .map((i) => serializeItem(db, i));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Archive</h1>
        <span className="font-mono text-[10px] text-fg-faint">{containers.length} containers · {items.length} items</span>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Containers</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {containers.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No archived containers.</li>}
          {containers.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 h-10">
              <span className="font-mono text-[10px] tracking-wider uppercase text-fg-muted border border-line rounded-sm px-1.5 py-0.5">{c.kind}</span>
              <Link href={`/c/${c.slug}`} className="flex-1 truncate text-[13px] hover:text-accent">{c.name}</Link>
              <span className="font-mono text-[10px] text-fg-faint">{c.archivedAt ? formatDate(c.archivedAt) : ""}</span>
              <RestoreButton kind="container" id={c.id} />
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Items</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No archived items.</li>}
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 h-10">
              <TypeBadge type={i.type} />
              <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{i.title}</Link>
              {i.container && <span className="font-mono text-[10px] text-fg-faint">{i.container.name}</span>}
              <span className="font-mono text-[10px] text-fg-faint">{i.archivedAt ? formatDate(i.archivedAt) : ""}</span>
              <RestoreButton kind="item" id={i.id} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Build and check**

Run: `npm test && npm run build`. With the dev server: create a project on `/projects`, open it, set a goal and deadline, ⌘S, add a "Capture here" note, press Complete, choose "Move them to an area" and create an area from the picker, confirm the project appears on `/archive` and the note shows up under the area page, restore the project. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): project, area, resource pages with container editor, completion flow, and archive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 10: People pages and item editor homes

**Files:**
- Create: `src/components/people-picker.tsx`, `src/components/person-editor.tsx`, `src/components/new-person-form.tsx`, `src/app/people/[slug]/page.tsx`
- Modify: `src/app/people/page.tsx`, `src/components/item-editor.tsx`

**Interfaces:**
- Produces: `PeoplePicker({ selected: number[], onChange(ids), onClose })`, `PersonEditor({ initial: PersonDTO })`, `NewPersonForm()`, `/people` and `/people/[slug]`; the item editor shows the container chip with Move, an Archive/Restore button, and people chips with a picker.

- [ ] **Step 1: People list, form, and person page**

Create `src/components/new-person-form.tsx` exactly like `NewContainerForm` but posting to `/api/people` with `{ name }`, placeholder "New person", and no kind prop.

Replace `src/app/people/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/db/client";
import { listPeople } from "@/domain/people";
import { serializePerson } from "@/lib/api";
import { NewPersonForm } from "@/components/new-person-form";

export const dynamic = "force-dynamic";

export default function PeoplePage() {
  const people = listPeople(getDb()).map((p) => serializePerson(p));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">People</h1>
        <span className="font-mono text-[10px] text-fg-faint">{people.length} people · mention with @slug in any note</span>
      </header>
      <NewPersonForm />
      <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
        {people.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">Nobody yet.</li>}
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 h-10 hover:bg-surface-2 transition-colors duration-150">
            <Link href={`/people/${p.slug}`} className="flex-1 truncate text-[13.5px] hover:text-accent">{p.name}</Link>
            <span className="font-mono text-[10px] text-fg-faint">@{p.slug}</span>
            <span className="font-mono text-[10px] text-fg-faint w-14 text-right">{p.itemCount} items</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `src/components/person-editor.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import type { PersonDTO } from "@/lib/dto";

export function PersonEditor({ initial }: { initial: PersonDTO }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [profile, setProfile] = useState(initial.profile);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, profile }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      const p = (await res.json()) as PersonDTO;
      setDirty(false);
      if (p.slug !== initial.slug) router.replace(`/people/${p.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, profile, saving]);

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/people/${initial.id}`, { method: "DELETE" });
    if (res.ok) router.push("/people");
    else setError("Delete failed");
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-3 h-8">
        <Link href="/people" className="font-mono text-[11px] text-fg-muted hover:text-fg">← people</Link>
        <span className="font-mono text-[10px] text-fg-faint">@{initial.slug}</span>
        <span className={`font-mono text-[10px] ${error ? "text-danger" : "text-fg-faint"}`}>{saving ? "saving" : dirty ? "unsaved · ⌘S" : ""}</span>
        <span className="flex-1" />
        <button onClick={() => setPreview((p) => !p)} className={`h-7 px-2 rounded-md text-[12px] border ${preview ? "border-accent text-accent" : "border-line hover:border-line-strong"}`}>{preview ? "Edit" : "Preview"}</button>
        <button onClick={() => void remove()} onBlur={() => setConfirmDelete(false)} className={`h-7 px-2 rounded-md text-[12px] border ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}>{confirmDelete ? "Confirm delete" : "Delete"}</button>
        <button onClick={() => void save()} disabled={!dirty || saving} className="h-7 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">Save</button>
      </header>
      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}
      <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="w-full bg-transparent outline-none text-2xl font-medium tracking-tight" />
      {preview ? (
        <div className="md min-h-[200px]"><Markdown>{profile || "*No profile yet.*"}</Markdown></div>
      ) : (
        <textarea value={profile} onChange={(e) => { setProfile(e.target.value); setDirty(true); }} placeholder={"Who they are, role, how you work together, open threads"} className="w-full min-h-[200px] resize-y bg-surface-1 border border-line rounded-lg px-4 py-3 outline-none leading-relaxed" />
      )}
    </div>
  );
}
```

Create `src/app/people/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPersonBySlug, getPersonTimeline } from "@/domain/people";
import { serializeItem, serializePerson } from "@/lib/api";
import { PersonEditor } from "@/components/person-editor";
import { TypeBadge } from "@/components/badges";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const person = getPersonBySlug(db, slug);
  if (!person) notFound();
  const timeline = getPersonTimeline(db, person.id).map((i) => serializeItem(db, i));
  return (
    <div className="w-full max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
      <PersonEditor key={person.id} initial={serializePerson(person, timeline.length)} />
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Timeline · {timeline.length}</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {timeline.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No linked items yet.</li>}
          {timeline.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 h-10">
              <span className="font-mono text-[10px] text-fg-faint w-20">{formatDate(i.createdAt)}</span>
              <TypeBadge type={i.type} />
              <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{i.title}</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: People picker and item editor changes**

Create `src/components/people-picker.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PersonDTO } from "@/lib/dto";

interface Props {
  selected: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}

export function PeoplePicker({ selected, onChange, onClose }: Props) {
  const [all, setAll] = useState<PersonDTO[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/people")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PersonDTO[]) => {
        if (!cancelled) setAll(list);
      })
      .catch(() => {});
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const options = useMemo(() => (q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q)) : all), [all, q]);
  const exact = options.some((p) => p.name.toLowerCase() === q);

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function create() {
    if (!q || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: query.trim() }) });
      if (res.ok) {
        const p = (await res.json()) as PersonDTO;
        setAll((a) => [...a, p]);
        onChange([...selected, p.id]);
        setQuery("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[18vh]" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 h-8 flex items-center font-mono text-[10px] tracking-wider uppercase text-fg-faint border-b border-line">People on this item</div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && q && !exact) {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="Filter, or type a new name and press Enter"
          className="w-full h-11 px-4 bg-transparent border-b border-line outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {options.map((p) => (
            <li key={p.id} onClick={() => toggle(p.id)} className="px-4 h-9 flex items-center justify-between cursor-pointer hover:bg-surface-3">
              <span className={selected.includes(p.id) ? "text-fg" : "text-fg-muted"}>{p.name}</span>
              <span className="font-mono text-[10px] text-fg-faint">{selected.includes(p.id) ? "✓ linked" : `@${p.slug}`}</span>
            </li>
          ))}
          {q && !exact && <li onClick={() => void create()} className="px-4 h-9 flex items-center cursor-pointer text-accent">Create “{query.trim()}”</li>}
          {options.length === 0 && !q && <li className="px-4 py-2 text-fg-faint">Nobody yet. Type a name.</li>}
        </ul>
        <div className="px-4 h-9 flex items-center justify-end border-t border-line">
          <button onClick={onClose} className="text-[12px] text-fg-muted hover:text-fg">Done</button>
        </div>
      </div>
    </div>
  );
}
```

In `src/components/item-editor.tsx`:

1. Add imports: `import { ContainerPicker } from "./container-picker";`, `import { PeoplePicker } from "./people-picker";`.
2. Add state: `const [movePicker, setMovePicker] = useState(false);` and `const [peoplePicker, setPeoplePicker] = useState(false);`.
3. Add a helper next to `retry()`:

```tsx
  async function patchMeta(body: Record<string, unknown>) {
    setActionError(null);
    const res = await fetch(`/api/items/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setActionError(await readError(res));
      return;
    }
    setItem((await res.json()) as ItemDTO);
  }
```

(reuse the file's existing `readError` helper if present; otherwise add the same one used in `capture-box.tsx`).

4. In the header, after the StatusBadge, add the home chip:

```tsx
        <button onClick={() => setMovePicker(true)} className="h-6 px-2 rounded-sm font-mono text-[10px] tracking-wider uppercase border border-line hover:border-accent hover:text-accent">
          {item.container ? `${item.container.kind} · ${item.container.name}` : "inbox"}
        </button>
        {item.archivedAt && <span className="font-mono text-[10px] text-warn">archived</span>}
```

and next to the Delete button add:

```tsx
        <button onClick={() => void patchMeta({ archived: !item.archivedAt })} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong">
          {item.archivedAt ? "Restore" : "Archive"}
        </button>
```

5. Under the tags input add the people row:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        {item.people.map((p) => (
          <Link key={p.id} href={`/people/${p.slug}`} className="font-mono text-[11px] text-fg-muted hover:text-accent">@{p.slug}</Link>
        ))}
        <button onClick={() => setPeoplePicker(true)} className="font-mono text-[11px] text-fg-faint hover:text-fg">+ person</button>
      </div>
```

6. At the end of the JSX (inside the root div) render the pickers:

```tsx
      {movePicker && (
        <ContainerPicker
          allowInbox
          onClose={() => setMovePicker(false)}
          onPick={(c) => {
            setMovePicker(false);
            void patchMeta({ containerId: c ? c.id : null });
          }}
        />
      )}
      {peoplePicker && (
        <PeoplePicker selected={item.people.map((p) => p.id)} onChange={(ids) => void patchMeta({ people: ids })} onClose={() => setPeoplePicker(false)} />
      )}
```

- [ ] **Step 3: Build and check**

Run: `npm test && npm run build`. With the dev server: create a person, write a note mentioning `@their-slug`, open the note and confirm the person chip appears, open the person page and confirm the timeline lists the note; on the note, use the home chip to move it to a project and archive/restore it. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): people pages, people picker, and item home controls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 11: Capture homes, duplicate handling, and container filters

**Files:**
- Modify: `src/components/capture-box.tsx`, `src/components/capture-screen.tsx`, `src/app/capture/page.tsx`, `src/app/library/page.tsx`, `src/components/search-panel.tsx`

**Interfaces:**
- `CaptureBox` and `CaptureScreen` take `defaultContainer?: ContainerRefDTO | null`; `/capture?to=<slug>` pre-selects that container. A 409 shows "already saved" with a link and a "Save anyway" button. Library gets a container select and an "include archived" toggle (`?container=<id>|inbox&archived=1`); Search gets the same as controls.

- [ ] **Step 1: Capture box**

In `src/components/capture-box.tsx`:

1. Imports: `import Link from "next/link";`, `import type { ContainerDTO, ContainerRefDTO, ItemDTO } from "@/lib/dto";`, `import { ContainerPicker } from "./container-picker";`.
2. Props become `{ onCaptured: (item: ItemDTO) => void; defaultContainer?: ContainerRefDTO | null }`.
3. State: `const [target, setTarget] = useState<ContainerRefDTO | null>(defaultContainer ?? null);`, `const [picker, setPicker] = useState(false);`, `const [duplicate, setDuplicate] = useState<{ existingId: number } | null>(null);`.
4. Change `submit` to take `force = false`: in the link body add `containerId: target?.id ?? null, force`; in the note body add `containerId: target?.id ?? null`; in the upload form append `containerId` when `target` is set. When the `/api/items` response status is 409, parse `{ existingId }`, call `setDuplicate({ existingId })`, and return without clearing the text. On success also `setDuplicate(null)`.
5. In the footer row, before the tags input, add the home chip:

```tsx
        <button type="button" onClick={() => setPicker(true)} className="h-6 px-2 rounded-sm font-mono text-[10px] tracking-wider uppercase border border-line hover:border-accent hover:text-accent shrink-0">
          {target ? `${target.kind} · ${target.name}` : "inbox"}
        </button>
```

6. After the error line add the duplicate notice:

```tsx
      {duplicate && (
        <div className="px-4 py-2 text-[12px] border-t border-line flex items-center gap-3">
          <span className="text-warn">Already saved.</span>
          <Link href={`/items/${duplicate.existingId}`} className="text-accent hover:underline">Open it</Link>
          <button type="button" onClick={() => void submit(true)} className="text-fg-muted hover:text-fg">Save anyway</button>
        </div>
      )}
```

7. Render the picker at the end of the section:

```tsx
      {picker && (
        <ContainerPicker
          allowInbox
          title="Capture into"
          onClose={() => setPicker(false)}
          onPick={(c: ContainerDTO | null) => {
            setPicker(false);
            setTarget(c ? { id: c.id, name: c.name, slug: c.slug, kind: c.kind } : null);
          }}
        />
      )}
```

Update `src/components/capture-screen.tsx` to accept and forward `defaultContainer`, and replace `src/app/capture/page.tsx`:

```tsx
import { getDb } from "@/db/client";
import { getContainerBySlug } from "@/domain/containers";
import { CaptureScreen } from "@/components/capture-screen";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  const c = to ? getContainerBySlug(getDb(), to) : undefined;
  const defaultContainer = c && c.status === "active" ? { id: c.id, name: c.name, slug: c.slug, kind: c.kind } : null;
  return <CaptureScreen defaultContainer={defaultContainer} />;
}
```

- [ ] **Step 2: Library filters**

In `src/app/library/page.tsx`: extend `SP` with `container?: string; archived?: string`; parse `container` with the same rule as the API (`inbox` → null, digits → number, else undefined) and `archived === "1"`; pass `containerId` and `includeArchived` to `listItems`; load `const containers = listContainers(db, { status: "active" })` (import from `@/domain/containers`); in the date `<form>` add a `<select name="container">` with options "any home", "inbox", and each container (`value={c.id}`, label `${c.kind} · ${c.name}`), plus `<label><input type="checkbox" name="archived" value="1" defaultChecked={archived} /> include archived</label>`, all submitted with the existing Apply button (the form already carries the chip filters as hidden inputs; add `container` and `archived` to `href()` merging the same way).

- [ ] **Step 3: Search filters**

In `src/components/search-panel.tsx`: add state `container` (string, `""` any, `"inbox"`, or an id) and `archived` (boolean); fetch `/api/containers?status=active` once (with the cancelled flag pattern) into `containers`; render a `<select>` with "any home", "inbox", and containers, plus an "include archived" checkbox styled like the other controls; include `container` and `archived=1` in the query params and in the effect's dependency list.

- [ ] **Step 4: Build and check**

Run: `npm test && npm run build`. With the dev server: open a project page, click "Capture here", confirm the chip shows the project, capture a note, confirm it lands in the project; capture the same Wikipedia link twice and confirm the second attempt shows "Already saved" with a working "Open it" and "Save anyway"; filter Library and Search by that project and by inbox. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): capture into a home, duplicate notice, container filters in library and search

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 12: Lint, smoke, and README

**Files:**
- Modify: `README.md`, anything lint reports

- [ ] **Step 1: Lint**

Run: `npm run lint`. Zero errors required. The two `eslint-disable-next-line react-hooks/exhaustive-deps` comments introduced in Tasks 8 to 10 are acceptable only if the rule is enabled in this config; if lint reports them as unused disables, remove them.

- [ ] **Step 2: Smoke on a fresh data directory**

```bash
export SB_DATA_DIR=$(mktemp -d)
npm run build && npm start &
sleep 6
P=$(curl -s -X POST localhost:3141/api/containers -H 'content-type: application/json' -d '{"kind":"project","name":"Smoke launch","deadline":"2026-12-01"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
curl -s -X POST localhost:3141/api/items -H 'content-type: application/json' -d "{\"type\":\"note\",\"body\":\"Kickoff with @nobody\",\"containerId\":$P}" | head -c 200; echo
curl -s -X POST localhost:3141/api/items -H 'content-type: application/json' -d '{"type":"note","body":"Loose thought"}' | head -c 120; echo
curl -s localhost:3141/api/inbox | head -c 200; echo
curl -s -X POST localhost:3141/api/items -H 'content-type: application/json' -d '{"type":"link","url":"https://example.com/?utm_source=a"}' | head -c 120; echo
curl -s -o /dev/null -w "dup: %{http_code}\n" -X POST localhost:3141/api/items -H 'content-type: application/json' -d '{"type":"link","url":"https://example.com"}'
curl -s -X POST "localhost:3141/api/containers/$P/archive" -H 'content-type: application/json' -d '{"moveItemsTo":null}' | head -c 120; echo
curl -s localhost:3141/api/inbox | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('inbox count', JSON.parse(s).count))"
for p in /inbox /projects /areas /resources /people /archive /library /search /capture; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3141$p; done
kill %1
```

Expected: the project is created, the first note has `containerId` set, the inbox count is 2 (loose thought and link) and becomes 3 after the project is archived with its note sent to the Inbox, the duplicate returns 409, and every page returns 200.

- [ ] **Step 3: README**

In `README.md`, replace the Keyboard table with:

```markdown
| Keys | Action |
|---|---|
| `⌘K` | Command palette |
| `g i` `g p` `g a` `g r` `g e` `g l` `g x` `g s` `g c` | Inbox, Projects, Areas, Resources, People, Library, Archive, Search, Capture |
| `/` | Focus search |
| `⌘↵` | Capture |
| `⌘S` | Save item, container, or person |
| In the Inbox: `p` `a` `r` `e` `x` `j` `k` `l` | File to project / area / resource, archive, delete, next, previous, list view |
```

and add a section before "Design docs":

```markdown
## How things are organised

PARA. Every capture lands in the Inbox. Processing the Inbox files each item into exactly one home: a **Project** (an outcome with a deadline), an **Area** (a responsibility with a standard), or a **Resource** (a topic, grouped by category). Anything inactive is **Archived**, and completing a project asks where its items should go. People are a light CRM: mention `@slug` in a note to link it to a person.
```

- [ ] **Step 4: Final test run and commit**

Run: `npm test && npm run build`

```bash
git add -A
git commit -m "docs: PARA organisation and keyboard reference

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```
