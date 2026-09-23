# Time-Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a planned task take a slot on the Day view's timeline, so the day reads as one sequence of meetings and work and the capacity line says how much of the plan is placed.

**Architecture:** A task carries one nullable `scheduledAt` local timestamp. The timeline already lays out meetings into columns; task blocks join the same layout with their own look and their own interactions (drop from the plan, drag to move, resize handle, keyboard). Capacity gains a `blockedMinutes` figure computed server-side from the plan. Everything writes through the existing task PATCH route and refreshes through `sb:tasks-changed`.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint: no synchronous setState in effect bodies), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3 (`npx drizzle-kit generate --name <name>` writes SQL, journal and snapshot), zod 4, Vitest 5 jsdom, `motion` 12.

**Spec:** `docs/superpowers/specs/2026-09-23-time-blocking-design.md`

## Global Constraints

- Carbon tokens only (`src/test/tokens.test.ts` bans retired classes); sentence case; `focus-ring` on every interactive element; `aria-label` on icon-only controls; no synchronous `setState` in effect bodies; `localStorage` unused here; tests never touch the network.
- `scheduledAt` format `YYYY-MM-DDTHH:MM:SS` (local, no offset); block length = `estimateMinutes ?? 25`; snapping 5 minutes; keyboard moves 15 minutes (`Shift` 5), `Alt` + arrows resize by 5; estimates stay within 5–480.
- Commit trailers on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts`, `drizzle/0010_*.sql` | `tasks.scheduled_at` |
| `src/domain/tasks/index.ts` | `scheduledAt` on create/update with validation |
| `src/domain/plan/index.ts` | clear `scheduledAt` on unplan and carry-over; `sortPlanByTime` |
| `src/lib/validation.ts`, `src/lib/api.ts`, `src/lib/dto.ts` | `LocalTimestamp`, DTO field, `blockedMinutes` in capacity DTOs |
| `src/lib/capacity.ts` | `blockLength`, `blockedMinutes` |
| `src/lib/planner.ts` | blocked figure in day and week payloads |
| `src/app/api/plan/sort/route.ts` | `POST /api/plan/sort` |
| `src/components/planner/timeline-layout.ts` | layout accepts task blocks (already generic over `{ id, startsAt, endsAt }`) |
| `src/components/planner/timeline.tsx`, `task-block.tsx` | task blocks, drop, move, resize, keyboard, ghost |
| `src/components/planner/plan-pane.tsx`, `src/components/tasks/task-row.tsx` | time chip, Block now, Take off the timeline, Sort by time |
| `src/components/planner/capacity-line.tsx`, `week-view.tsx` | blocked figure and dot |

---

### Task 1: Data, domain, capacity, routes

**Files:**
- Modify: `src/db/schema.ts` (+ generated `drizzle/0010_task_scheduled_at.sql` and snapshot), `src/domain/tasks/index.ts` (+ test), `src/domain/plan/index.ts` (+ test), `src/lib/validation.ts`, `src/lib/api.ts`, `src/lib/dto.ts`, `src/lib/capacity.ts` (+ test), `src/lib/planner.ts` (+ test)
- Create: `src/app/api/plan/sort/route.ts`, test in `src/app/api/plan.test.ts`

**Interfaces:**
- Produces: `TaskDTO.scheduledAt: string | null`; `TaskBody`/`PatchTaskBody` accept `scheduledAt: LocalTimestamp | null`; `LocalTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)` exported from `src/lib/validation.ts`; `blockLength(task: { estimateMinutes: number | null }): number` (estimate or 25); `blockedMinutes(tasks: { status: string; estimateMinutes: number | null; scheduledAt: string | null }[], date: string): number`; `CapacityDTO.blockedMinutes: number` and `PlannerWeekDayDTO.capacity.blockedMinutes: number`; `sortPlanByTime(db, date): PlanTask[]`; `POST /api/plan/sort { date }` → `{ date, tasks }`; `removeFromPlan` and `carryOver` clear `scheduledAt` for the tasks they touch (carry-over clears it on the moved task, since its block belonged to the old day).

- [ ] **Step 1: Schema and migration**

In `src/db/schema.ts` tasks table, after `estimateMinutes`:

```ts
    /** When the task's block starts on the timeline, a local timestamp; null when unblocked. */
    scheduledAt: text("scheduled_at"),
```

Run `npx drizzle-kit generate --name task_scheduled_at`; expect `drizzle/0010_task_scheduled_at.sql` with `ALTER TABLE \`tasks\` ADD \`scheduled_at\` text;` and `drizzle/meta/0010_snapshot.json`.

- [ ] **Step 2: Failing domain tests**

`src/domain/tasks/index.test.ts`:

```ts
  it("sets, validates and clears a block start", () => {
    const task = createTask(t.db, { title: "Write", scheduledAt: "2026-09-23T10:30:00" });
    expect(task.scheduledAt).toBe("2026-09-23T10:30:00");
    expect(updateTask(t.db, task.id, { scheduledAt: null }).scheduledAt).toBeNull();
    expect(() => updateTask(t.db, task.id, { scheduledAt: "2026-09-23 10:30" })).toThrow(/YYYY-MM-DDTHH:MM:SS/);
    expect(() => updateTask(t.db, task.id, { scheduledAt: "2026-09-23T25:00:00" })).toThrow(/YYYY-MM-DDTHH:MM:SS/);
  });
```

`src/domain/plan/index.test.ts` (follow its fixture):

```ts
  it("clears a block when the task leaves the plan or is carried over", () => {
    const a = createTask(t.db, { title: "A", scheduledAt: "2026-09-23T10:00:00" });
    const b = createTask(t.db, { title: "B", scheduledAt: "2026-09-23T11:00:00" });
    addToPlan(t.db, "2026-09-23", a.id);
    addToPlan(t.db, "2026-09-23", b.id);
    removeFromPlan(t.db, "2026-09-23", a.id);
    expect(getTask(t.db, a.id)!.scheduledAt).toBeNull();
    expect(carryOver(t.db, "2026-09-23", "2026-09-24")).toBe(1);
    expect(getTask(t.db, b.id)!.scheduledAt).toBeNull();
  });

  it("sorts the plan by block time, unblocked rows keeping their order at the end", () => {
    const late = createTask(t.db, { title: "Late", scheduledAt: "2026-09-23T15:00:00" });
    const early = createTask(t.db, { title: "Early", scheduledAt: "2026-09-23T09:00:00" });
    const loose1 = createTask(t.db, { title: "Loose 1" });
    const loose2 = createTask(t.db, { title: "Loose 2" });
    for (const id of [loose1.id, late.id, loose2.id, early.id]) addToPlan(t.db, "2026-09-23", id);
    expect(sortPlanByTime(t.db, "2026-09-23").map((p) => p.title)).toEqual(["Early", "Late", "Loose 1", "Loose 2"]);
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/domain/tasks src/domain/plan`
Expected: FAIL.

- [ ] **Step 4: Implement the domain**

`src/lib/validation.ts`: `export const LocalTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);` and `scheduledAt: LocalTimestamp.nullable().optional()` in `TaskBody`.

`src/domain/tasks/index.ts`: `scheduledAt?: string | null` on both inputs;

```ts
const LOCAL_TS = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
function checkScheduledAt(v: string | null | undefined): void {
  if (v == null) return;
  if (!LOCAL_TS.test(v) || Number.isNaN(Date.parse(v))) throw new TaskError("A block start is YYYY-MM-DDTHH:MM:SS in local time", 400);
}
```

applied in `createTask` (insert `scheduledAt: input.scheduledAt ?? null`) and `updateTask` (`if (patch.scheduledAt !== undefined) { checkScheduledAt(patch.scheduledAt); set.scheduledAt = patch.scheduledAt; }`).

`src/domain/plan/index.ts`: in `removeFromPlan`, after the delete, `db.update(tasks).set({ scheduledAt: null, updatedAt: nowIso() }).where(eq(tasks.id, taskId)).run();` (import `tasks` is already there). In `carryOver`, for each task moved, clear its `scheduledAt` the same way. Add:

```ts
/** Blocked tasks first in clock order; the rest keep their order after them. */
export function sortPlanByTime(db: DB, date: string): PlanTask[] {
  const current = listPlan(db, date);
  const blocked = current.filter((t) => t.scheduledAt?.startsWith(date)).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const rest = current.filter((t) => !t.scheduledAt?.startsWith(date));
  return reorderPlan(db, date, [...blocked, ...rest].map((t) => t.id));
}
```

`src/lib/api.ts` `serializeTask`: `scheduledAt: t.scheduledAt,`; `src/lib/dto.ts` `TaskDTO.scheduledAt: string | null`. Update every `TaskDTO` fixture (`grep -rn "estimateMinutes: " src --include=*.test.tsx --include=*.test.ts` and add `scheduledAt: null` beside it).

- [ ] **Step 5: Run the domain tests and typecheck**

Run: `npx vitest run src/domain && npx tsc --noEmit`

- [ ] **Step 6: Failing capacity and payload tests**

`src/lib/capacity.test.ts`:

```ts
  it("counts blocked minutes on the day only, estimate or the 25-minute default", () => {
    const tasks = [
      { status: "open", estimateMinutes: 60, scheduledAt: "2026-09-23T10:00:00" },
      { status: "open", estimateMinutes: null, scheduledAt: "2026-09-23T14:00:00" },
      { status: "done", estimateMinutes: 30, scheduledAt: "2026-09-23T15:00:00" },
      { status: "open", estimateMinutes: 45, scheduledAt: "2026-09-24T09:00:00" },
      { status: "open", estimateMinutes: 45, scheduledAt: null },
    ];
    expect(blockLength({ estimateMinutes: null })).toBe(25);
    expect(blockedMinutes(tasks, "2026-09-23")).toBe(85);
  });
```

`src/lib/planner.test.ts`: extend the sources/capacity test so one planned task has `scheduledAt: "2026-09-23T10:00:00"` and assert `day.capacity.blockedMinutes` and `week.days[2].capacity.blockedMinutes`.

`src/app/api/plan.test.ts`: `POST /api/plan/sort { date }` returns the sorted tasks and 400 without a date.

- [ ] **Step 7: Implement capacity, payloads and the route**

`src/lib/capacity.ts`:

```ts
export const DEFAULT_BLOCK_MINUTES = 25;
export function blockLength(task: { estimateMinutes: number | null }): number {
  return task.estimateMinutes ?? DEFAULT_BLOCK_MINUTES;
}
/** Open tasks whose block starts on `date`, summed by their block length. */
export function blockedMinutes(tasks: { status: string; estimateMinutes: number | null; scheduledAt: string | null }[], date: string): number {
  return tasks.filter((t) => t.status === "open" && t.scheduledAt?.startsWith(date)).reduce((n, t) => n + blockLength(t), 0);
}
```

`src/lib/dto.ts`: `CapacityDTO.blockedMinutes: number`, `PlannerWeekDayDTO.capacity.blockedMinutes: number`. `src/lib/planner.ts`: day `capacity.blockedMinutes = blockedMinutes(plan, date)` (the plan rows), week per day `blockedMinutes(listPlan(db, date), date)`. Fix fixtures (`capacity: { ..., blockedMinutes: 0 }`).

`src/app/api/plan/sort/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sortPlanByTime } from "@/domain/plan";
import { errorResponse, serializePlanTask } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";
const Body = z.object({ date: DateString }).strict();

/** Reorders the day's plan to follow its blocks; unblocked rows keep their order at the end. */
export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json({ date: parsed.data.date, tasks: sortPlanByTime(getDb(), parsed.data.date).map(serializePlanTask) });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 8: Run everything and commit**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`

```bash
git add -A drizzle src
git commit -m "feat(planner): a task can hold a block start; blocked minutes in capacity; sort the plan by time

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Task blocks on the timeline

**Files:**
- Create: `src/components/planner/task-block.tsx`, `src/components/planner/block-math.ts` (+ test)
- Modify: `src/components/planner/timeline.tsx` (+ test), `src/components/planner/day-view.tsx`, `src/components/planner/plan-pane.tsx` (drag source only)
- Test: `src/components/planner/timeline.test.tsx`, `src/components/planner/block-math.test.ts`

**Interfaces:**
- Consumes: `PlanTaskDTO.scheduledAt`, `blockLength`, `layoutBlocks({ id, startsAt, endsAt }[])`, `PLAN_DRAG_MIME` from `./drag-mime` (plan rows already set it on drag start), `PATCH /api/tasks/:id { scheduledAt | estimateMinutes }`, `sb:tasks-changed`, `sb:toast`.
- Produces: `Timeline` props gain `tasks: PlanTaskDTO[]` and `onPatchTask(id, body): Promise<boolean>`; `src/components/planner/block-math.ts` exports `snap(minutes: number, step = 5): number`, `minutesToIso(date: string, minutesOfDay: number): string` ("2026-09-23T10:35:00"), `isoToMinutes(iso: string): number`, `blockEnd(task): string`; `TaskBlock` component; block ids in the layout are `-task.id` so they never collide with meeting ids (layout is generic over ids).

- [ ] **Step 1: Failing math tests**

`src/components/planner/block-math.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockEnd, isoToMinutes, minutesToIso, snap } from "./block-math";

describe("block math", () => {
  it("snaps to five minutes and converts both ways", () => {
    expect(snap(632)).toBe(630);
    expect(snap(633)).toBe(635);
    expect(snap(7, 15)).toBe(0);
    expect(minutesToIso("2026-09-23", 635)).toBe("2026-09-23T10:35:00");
    expect(isoToMinutes("2026-09-23T10:35:00")).toBe(635);
  });
  it("ends a block its estimate later, or 25 minutes later", () => {
    expect(blockEnd({ scheduledAt: "2026-09-23T10:35:00", estimateMinutes: 50 })).toBe("2026-09-23T11:25:00");
    expect(blockEnd({ scheduledAt: "2026-09-23T23:50:00", estimateMinutes: null })).toBe("2026-09-24T00:15:00");
  });
});
```

- [ ] **Step 2: Implement `block-math.ts`**

```ts
import { blockLength } from "@/lib/capacity";

export const SNAP_MINUTES = 5;

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local timestamp for `minutesOfDay` on `date`; minutes past midnight roll into the next day. */
export function minutesToIso(date: string, minutesOfDay: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(y, m - 1, d, 0, minutesOfDay, 0, 0);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
}

export function isoToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function blockEnd(task: { scheduledAt: string; estimateMinutes: number | null }): string {
  const start = new Date(task.scheduledAt);
  const end = new Date(start.getTime() + blockLength(task) * 60_000);
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
}
```

- [ ] **Step 3: Failing timeline tests**

Append to `src/components/planner/timeline.test.tsx` (its fixtures build `MeetingListDTO`s; add a `PlanTaskDTO` fixture `blocked` with `scheduledAt: \`${DATE}T10:30:00\``, `estimateMinutes: 45`, `planId: 1`, `status: "open"`, and `stubPatch()` recording PATCH bodies and answering `{}`; mount with `tasks={[blocked]}` and `onPatchTask` wired to fetch like the plan pane's `send`):

```tsx
  it("draws a planned task as a block at its start, its estimate tall", () => {
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    expect(block.style.top).toBe("90px");
    expect(block.style.height).toBe("45px");
  });

  it("drops a plan row onto the timeline at the snapped slot", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const column = screen.getByTestId("timeline-column");
    Object.defineProperty(column, "getBoundingClientRect", { value: () => ({ top: 100, left: 0, width: 400, height: 540 }) });
    const dt = { types: ["application/x-sb-plan"], getData: () => "7", dropEffect: "move" };
    fireEvent.dragOver(column, { dataTransfer: dt, clientY: 100 + 93 });
    expect(screen.getByTestId("block-ghost").style.top).toBe("95px");
    fireEvent.drop(column, { dataTransfer: dt, clientY: 100 + 93 });
    await waitFor(() => expect(posts).toEqual([{ id: 7, body: { scheduledAt: `${DATE}T10:35:00` } }]));
  });

  it("moves a block with the arrows, resizes with alt, and unblocks with backspace", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    block.focus();
    fireEvent.keyDown(block, { key: "ArrowDown" });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: `${DATE}T10:45:00` } }));
    fireEvent.keyDown(block, { key: "ArrowUp", shiftKey: true });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: `${DATE}T10:25:00` } }));
    fireEvent.keyDown(block, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { estimateMinutes: 50 } }));
    fireEvent.keyDown(block, { key: "Backspace" });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: null } }));
  });

  it("completes a block in place and dims a done one", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[{ ...blocked, status: "done" }]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: /Write the note/ });
    expect(block.className).toMatch(/opacity-50/);
    fireEvent.click(within(block).getByRole("checkbox"));
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { status: "open" } }));
  });
```

(Keyboard moves are relative to the task's current `scheduledAt` prop; the test's fixture does not update between keys, so each expectation is from 10:30: down 15 → 10:45, shift-up 5 → 10:25, alt-down 5 → estimate 50. Write the tests to match that.)

- [ ] **Step 4: Implement the block and the timeline changes**

`src/components/planner/task-block.tsx`:

```tsx
"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PlanTaskDTO } from "@/lib/dto";
import { formatMinutes } from "@/lib/capacity";
import { formatClock } from "../activity/format";
import { blockEnd, isoToMinutes, minutesToIso, snap } from "./block-math";

interface Props {
  task: PlanTaskDTO;
  date: string;
  /** Pixel geometry from the layout, in minutes from the column's start. */
  top: number;
  height: number;
  col: number;
  cols: number;
  pxPerMin: number;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<boolean>;
  /** Moving from the pointer: the timeline owns the ghost, the block only reports. */
  onDragStart: (e: PointerEvent<HTMLDivElement>) => void;
}

const MOVE = 15;
const FINE = 5;

/**
 * A planned task on the timeline: the title, the hours, an estimate, a checkbox that finishes
 * it where it sits. Arrows move it, Alt and arrows resize it, Backspace takes it off the
 * timeline (the task stays on the plan). Done blocks stay, dimmed and struck through.
 */
export function TaskBlock({ task, date, top, height, col, cols, pxPerMin, onPatch, onDragStart }: Props) {
  const [resizing, setResizing] = useState(false);
  const start = task.scheduledAt!;
  const end = blockEnd({ scheduledAt: start, estimateMinutes: task.estimateMinutes });
  const done = task.status === "done";
  const name = `${task.title}, ${formatClock(start)} to ${formatClock(end)}`;

  async function move(deltaMinutes: number) {
    const next = Math.max(0, Math.min(24 * 60 - 5, snap(isoToMinutes(start) + deltaMinutes)));
    if (await onPatch(task.id, { scheduledAt: minutesToIso(date, next) })) {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: `Moved to ${formatClock(minutesToIso(date, next))}` } }));
    }
  }
  async function resize(deltaMinutes: number) {
    const next = Math.max(5, Math.min(480, (task.estimateMinutes ?? 25) + deltaMinutes));
    await onPatch(task.id, { estimateMinutes: next });
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? FINE : MOVE;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sign = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) void resize(sign * FINE);
      else void move(sign * step);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      void onPatch(task.id, { scheduledAt: null });
    }
  }

  // Resizing by pointer: the bottom edge follows the pointer in 5-minute steps and writes the
  // estimate once on release.
  function onResizeDown(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startLen = task.estimateMinutes ?? 25;
    setResizing(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      const next = Math.max(5, Math.min(480, snap(startLen + (ev.clientY - startY) / pxPerMin)));
      (e.currentTarget.parentElement as HTMLElement).style.height = `${next * pxPerMin}px`;
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      const next = Math.max(5, Math.min(480, snap(startLen + (ev.clientY - startY) / pxPerMin)));
      if (next !== startLen) void onPatch(task.id, { estimateMinutes: next });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      role="group"
      aria-label={name}
      tabIndex={0}
      data-task-block={task.id}
      onKeyDown={onKey}
      onPointerDown={done ? undefined : onDragStart}
      className={`focus-ring absolute rounded-md border-l-2 border-violet bg-violet-dim overflow-hidden select-none ${done ? "opacity-50" : ""} ${resizing ? "cursor-ns-resize" : "cursor-grab"}`}
      style={{
        top: top * pxPerMin,
        height: height * pxPerMin,
        left: `calc(3.5rem + (100% - 3.5rem) * ${col / cols})`,
        width: `calc((100% - 3.5rem) / ${cols} - 4px)`,
      }}
    >
      <div className="p-2 flex flex-col gap-0.5 h-full pointer-events-none">
        <span className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            aria-label={`Done: ${task.title}`}
            checked={done}
            onChange={() => void onPatch(task.id, { status: done ? "open" : "done" })}
            onPointerDown={(e) => e.stopPropagation()}
            className="focus-ring accent-violet w-3.5 h-3.5 shrink-0 pointer-events-auto"
          />
          <span className={`truncate text-[13px] ${done ? "line-through text-fg-muted" : ""}`}>{task.title}</span>
        </span>
        <span className="font-mono text-[11px] text-fg-faint">
          {formatClock(start)}–{formatClock(end)} · {formatMinutes(task.estimateMinutes ?? 25)}
        </span>
      </div>
      {!done && (
        <button
          type="button"
          aria-label={`Resize ${task.title}`}
          onPointerDown={onResizeDown}
          className="focus-ring absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize pointer-events-auto"
        />
      )}
    </div>
  );
}
```

`timeline.tsx`:
- Props: `tasks: PlanTaskDTO[]`, `onPatchTask: (id: number, body: Record<string, unknown>) => Promise<boolean>`.
- Blocks: `const taskSpans = tasks.filter((t) => t.scheduledAt?.startsWith(date) && t.status !== "dropped").map((t) => ({ id: -t.id, startsAt: t.scheduledAt!, endsAt: blockEnd(t) }))`; lay out `[...timed, ...taskSpans]` together so meetings and tasks share columns; render `TaskBlock` for negative ids, meetings for positive.
- The column `div` gets `data-testid="timeline-column"`, `onDragOver` accepting `PLAN_DRAG_MIME` (from `./drag-mime`), computing `minutesOfDay = dayStart * 60 + snap((e.clientY - rect.top) / PX_PER_MIN)` and setting `ghost` state `{ top, height: 25 }` (height from the dragged task when known: the plan pane sets a second data item `application/x-sb-plan-minutes` with the block length; fall back to 25); `onDragLeave` clears the ghost when leaving the column; `onDrop` calls `onPatchTask(id, { scheduledAt: minutesToIso(date, minutesOfDay) })` and clears the ghost. The ghost: `<div data-testid="block-ghost" aria-hidden className="absolute left-14 right-2 rounded-md border border-dashed border-violet bg-violet-dim/50 pointer-events-none" style={{ top: ghost.top * PX_PER_MIN, height: ghost.height * PX_PER_MIN }} />`.
- Pointer move of an existing block: `TaskBlock`'s `onDragStart` hands the timeline a pointer-drag session: on `pointermove` the ghost follows (snapped), on `pointerup` write `scheduledAt`; a click without movement (< 4 px) does nothing. Use `setPointerCapture` on the column.
- Plan rows already set `PLAN_DRAG_MIME`; in `plan-pane.tsx` also set `e.dataTransfer.setData("application/x-sb-plan-minutes", String(blockLength(task)))`.
- `day-view.tsx` passes `tasks={day.plan}` and `onPatchTask={(id, body) => patch...}`: add a small `patchTask` in DayView that PATCHes `/api/tasks/:id`, dispatches `sb:tasks-changed` on success and returns ok-ness (mirror `plan-pane`'s `send`).

- [ ] **Step 5: Run the tests, lint, types; commit**

Run: `npx vitest run src/components/planner && npm run lint && npx tsc --noEmit`

```bash
git add -A src
git commit -m "feat(planner): task blocks on the timeline: drop, move, resize, keyboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Plan chips, Block now, Sort by time, capacity figures, README

**Files:**
- Modify: `src/components/tasks/task-row.tsx` (+ test), `src/components/planner/plan-pane.tsx` (+ test), `src/components/planner/capacity-line.tsx` (+ test), `src/components/planner/week-view.tsx` (+ test), `src/components/planner/planner-shell.tsx`, `README.md`

**Interfaces:**
- Consumes: `TaskDTO.scheduledAt`, `CapacityDTO.blockedMinutes`, `PlannerWeekDayDTO.capacity.blockedMinutes`, `POST /api/plan/sort`, `minutesToIso`, `snap`.
- Produces: `TaskRow` props `onBlockNow?: () => void` (menu item "Block now", shortcut `n` on the focused row) and `onUnblock?: () => void` ("Take off the timeline", shown only when `task.scheduledAt` is set), plus a mono time chip (`aria-label="Blocked at 10:30"`, button) that dispatches `sb:timeline-focus` `{ taskId }`; the timeline listens and scrolls the block into view, focusing it. Plan pane header gets a small menu with "Sort by time". Capacity line shows "· 1h 20m blocked" after the free figure when blocked > 0. Week column shows a violet dot with `title="1h 20m blocked"` when blocked > 0.

- [ ] **Step 1: Failing tests**

`task-row.test.tsx`:

```tsx
describe("TaskRow blocks", () => {
  it("shows the block time, offers Block now and Take off the timeline, and answers n", () => {
    const onBlockNow = vi.fn();
    const onUnblock = vi.fn();
    const focus: unknown[] = [];
    window.addEventListener("sb:timeline-focus", (e) => focus.push((e as CustomEvent).detail));
    renderRow({ onBlockNow, onUnblock }, { ...task, scheduledAt: "2026-09-16T10:30:00" });
    fireEvent.click(screen.getByRole("button", { name: "Blocked at 10:30" }));
    expect(focus).toEqual([{ taskId: task.id }]);
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Take off the timeline" }));
    expect(onUnblock).toHaveBeenCalled();
    const title = screen.getByRole("button", { name: task.title });
    title.focus();
    fireEvent.keyDown(title, { key: "n" });
    expect(onBlockNow).toHaveBeenCalled();
  });
});
```

`plan-pane.test.tsx`: "Block now" on today PATCHes `scheduledAt` to now rounded up to 5 minutes (use `vi.setSystemTime`), is absent on another day; "Sort by time" posts to `/api/plan/sort` and dispatches `sb:plan-changed`.

`capacity-line.test.tsx`: with `blockedMinutes: 80` the status reads `… free · 1h 20m blocked · …`; with 0 no blocked segment.

`week-view.test.tsx`: a day with `blockedMinutes: 80` shows a dot titled "1h 20m blocked".

- [ ] **Step 2: Implement**

`task-row.tsx`: props `onBlockNow?`, `onUnblock?`; the time chip after the estimate chip when `task.scheduledAt`:

```tsx
{task.scheduledAt && (
  <button type="button" aria-label={`Blocked at ${formatClock(task.scheduledAt)}`} onClick={() => window.dispatchEvent(new CustomEvent("sb:timeline-focus", { detail: { taskId: task.id } }))} className="focus-ring font-mono text-[11px] text-violet-bright rounded-sm px-1 shrink-0">
    {formatClock(task.scheduledAt)}
  </button>
)}
```

Menu items after the plan item: `{onBlockNow && !done && <button role="menuitem" …>Block now</button>}` and `{onUnblock && task.scheduledAt && <button role="menuitem" …>Take off the timeline</button>}`. In `onRowKeyDown`, `n` (same guards as `p`) calls `onBlockNow` when provided.

`plan-pane.tsx`: pass `onBlockNow` only when `day.date === today`: `() => patch(task.id, { scheduledAt: minutesToIso(today, snap(nowMinutes() + 4)) })` where `nowMinutes()` is the current local minutes-of-day and `snap(x + 4)` rounds up to the next 5; `onUnblock={() => patch(task.id, { scheduledAt: null })}`. Header: a `IconButton` (`MoreHorizontal`, label "Plan actions") with a small `role="menu"` holding "Sort by time" → `send("/api/plan/sort", "POST", { date: day.date }, "sb:plan-changed")`. (The sources drawer no longer exists; the plan picker under the plan is where tasks come from, and it needs no block controls.)

`timeline.tsx`: listen for `sb:timeline-focus`; `document.querySelector(\`[data-task-block="${taskId}"]\`)` → `scrollIntoView({ block: "center" })` and `focus()`.

`capacity-line.tsx`: after the free figure, `{capacity.blockedMinutes > 0 && <> · {formatMinutes(capacity.blockedMinutes)} blocked</>}`; the plan pane's bar gets an inner brighter segment `bg-violet-bright` sized `blocked / planned` of the fill when both > 0.

`week-view.tsx`: after the capacity line, `{day.capacity.blockedMinutes > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet ml-1 align-middle" title={\`${formatMinutes(day.capacity.blockedMinutes)} blocked\`} aria-label={\`${formatMinutes(day.capacity.blockedMinutes)} blocked\`} role="img" />}`.

README: a "Time-blocking" paragraph under Planner: drag a plan row onto the timeline, blocks follow the estimate (25 minutes without one), drag to move, drag the bottom edge or Alt + arrows to resize, arrows to move by 15 (Shift 5), Backspace to unblock, "Block now" / `n`, "Sort by time", the blocked figure.

- [ ] **Step 3: Run everything and commit**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`

```bash
git add -A src README.md
git commit -m "feat(planner): block times on rows, Block now, Sort by time, blocked capacity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: §2 one block per task, cleared on unplan/carry-over → Task 1; §3 placing (drop, ghost, snapping, overlap sharing), block look, move/resize by pointer and keyboard, unblock (menu, Backspace), Block now / `n` → Tasks 2 and 3; §4 time chip, focus the block, manual order kept, Sort by time → Task 3; §5 blocked figure, bar segment, week dot → Tasks 1 and 3; §6 migration, DTOs, validation, sort route, `blockedMinutes` → Task 1; §7 ghost look, focusable group with a name, toasts on keyboard moves → Task 2; §8 tests per task. Dragging a block back onto the plan list to unblock (spec §3) is covered by "Take off the timeline" and Backspace; the list-drop variant is left out as redundant (ruling: the plan list already accepts plan rows for reordering; a block dropped there would be ambiguous).
- Placeholders: none.
- Type consistency: `scheduledAt` string|null everywhere; `blockLength`/`blockEnd`/`minutesToIso`/`snap` names shared by Tasks 2 and 3; `onPatchTask(id, body): Promise<boolean>`; `sb:timeline-focus { taskId }`; `blockedMinutes` on both capacity DTOs.
