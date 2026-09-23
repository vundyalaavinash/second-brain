# Planning Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Day view the place where a day is planned: a sources drawer beside the plan, task estimates measured against free time, a morning ritual, and keyboard planning.

**Architecture:** The Day payload grows to carry every open task grouped by source plus a capacity summary, so the drawer, the plan and the header render from one fetch and refresh on the existing `sb:tasks-changed` / `sb:plan-changed` events. Pure helpers (`src/lib/capacity.ts`, `quickParse`) carry the arithmetic and parsing; components stay thin over the existing plan and task routes.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint: never call `setState` synchronously in an effect body), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3 (migrations via `npx drizzle-kit generate --name <name>`, which writes the SQL, journal entry and snapshot), zod 4, Vitest 5 (jsdom tests start with `// @vitest-environment jsdom`, `@testing-library/react`, `cleanup()` in `afterEach`), `motion` 12.

**Spec:** `docs/superpowers/specs/2026-09-23-planning-desk-design.md`

## Global Constraints

- Carbon tokens only: `pane`, `panel`, `micro` (uppercase labels only), `hairline-row`, `text-fg`, `text-fg-muted`, `text-fg-faint`, `text-danger`, `text-warn`, `bg-violet`, `bg-violet-dim`, `border-hairline`, `focus-ring`, `font-doc`, `font-mono`. `src/test/tokens.test.ts` fails the build on retired classes (ink/slate/brass/paper/tone=/on-paper/shadow-dock).
- Sentence case for every label and message. No em dashes in copy.
- Every interactive element has `focus-ring`; every icon-only control has an `aria-label`.
- No `setState` called synchronously inside a `useEffect` body; async responses may set state.
- `localStorage` access wrapped in try/catch and never read during render (read in an effect, or lazily in an event handler).
- Tests never hit the network: `vi.stubGlobal("fetch", ...)`.
- Motion honours `prefers-reduced-motion` (use `useReducedMotion` from `motion/react`).
- Working hours default `09:00-18:00`; estimate bounds 5–480 minutes; capacity tones: `warn` above 100 %, `danger` above 125 %.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts`, `drizzle/0009_*.sql` | `tasks.estimate_minutes` |
| `src/domain/tasks/index.ts`, `quick-parse.ts` | estimate on create/update; `~25m` suffix parsing |
| `src/lib/validation.ts`, `src/lib/api.ts`, `src/lib/dto.ts` | estimate in bodies and DTOs; new planner DTOs |
| `src/lib/capacity.ts` | pure capacity arithmetic and formatting |
| `src/domain/settings.ts` (unchanged) + `src/lib/work-hours.ts` | read/validate `planner.workHours` |
| `src/app/api/settings/planner/route.ts` | GET/PATCH working hours |
| `src/lib/planner.ts` | `plannerSources`, capacity in day and week payloads |
| `src/components/planner/sources-drawer.tsx` | tabs, groups, add/drag rows, search |
| `src/components/planner/plan-pane.tsx`, `day-view.tsx` | three-region layout, drop into the plan, capacity bar, ritual |
| `src/components/planner/ritual-strip.tsx` | the three-step strip |
| `src/components/planner/capacity-line.tsx` | header line and hours chip |
| `src/components/tasks/task-row.tsx` | estimate chip, `p` shortcut |
| `src/components/shell/prompt-bar.tsx`, `src/lib/intent.ts` | estimate in the task intent |
| `src/components/command-palette.tsx` | Plan section |
| `src/components/shell/toasts.tsx` | `sb:toast` window event |

---

### Task 1: Data, capacity arithmetic, working hours, payloads

**Files:**
- Modify: `src/db/schema.ts` (tasks table), generate `drizzle/0009_task_estimate.sql` + snapshot
- Modify: `src/domain/tasks/index.ts` (`CreateTaskInput`, `UpdateTaskInput`, `createTask`, `updateTask`), `src/domain/tasks/quick-parse.ts`
- Modify: `src/lib/validation.ts`, `src/lib/api.ts` (`serializeTask`), `src/lib/dto.ts`, `src/lib/intent.ts`, `src/lib/planner.ts`
- Create: `src/lib/capacity.ts`, `src/lib/capacity.test.ts`, `src/lib/work-hours.ts`, `src/app/api/settings/planner/route.ts`, `src/app/api/settings-planner.test.ts`
- Test: `src/domain/tasks/quick-parse.test.ts`, `src/lib/intent.test.ts`, `src/lib/planner.test.ts`, `src/app/api/tasks.test.ts`

**Interfaces:**
- Consumes: `listTasks(db, { status, containerId })`, `listContainers(db, { kind, status })`, `serializeContainers(db, list)`, `listPlan`, `listMeetings`, `getSetting/setSetting`.
- Produces:
  - `TaskDTO.estimateMinutes: number | null`; `TaskBody`/`PatchTaskBody` accept `estimateMinutes` (int 5–480 or null).
  - `quickParse(input, now)` returns `{ title, priority, dueDate, estimateMinutes: number | null }`; `Intent` task variant gains `estimateMinutes`.
  - `src/lib/capacity.ts`: `parseWorkHours(s: string): { start: number; end: number } | null` (minutes from midnight), `freeMinutes(meetings: CapacityMeeting[], workHours: string, date: string): number`, `plannedMinutes(tasks: { status: string; estimateMinutes: number | null }[]): { planned: number; unestimated: number }`, `formatMinutes(n: number): string`, `capacityTone(planned: number, free: number): "ok" | "warn" | "danger"`, `type CapacityMeeting = { startsAt: string; endsAt: string; allDay: boolean; status: string }`.
  - `src/lib/work-hours.ts`: `WORK_HOURS_KEY = "planner.workHours"`, `DEFAULT_WORK_HOURS = "09:00-18:00"`, `getWorkHours(db): string`, `setWorkHours(db, value): string` (throws `TaskError("Hours must be HH:MM-HH:MM with the start before the end", 400)` on bad input).
  - DTOs: `SourceGroupDTO = { container: ContainerDTO; tasks: TaskDTO[] }`, `PlannerSourcesDTO = { inbox: TaskDTO[]; due: { overdue: TaskDTO[]; today: TaskDTO[] }; projects: SourceGroupDTO[]; areas: SourceGroupDTO[] }`, `CapacityDTO = { freeMinutes: number; plannedMinutes: number; unestimated: number; workHours: string }`; `PlannerDayDTO` gains `sources: PlannerSourcesDTO` and `capacity: CapacityDTO` (and keeps `due` for one release: the plan pane still reads it until Task 2 moves it); `PlannerWeekDayDTO` gains `capacity: { freeMinutes: number; plannedMinutes: number }`.
  - `plannerSources(db, date): PlannerSourcesDTO`, `GET/PATCH /api/settings/planner` → `{ workHours }`.

- [ ] **Step 1: Schema and migration**

In `src/db/schema.ts`, after `recurrence: text("recurrence"),` add:

```ts
    /** Minutes the task is expected to take; null when nobody has guessed. */
    estimateMinutes: integer("estimate_minutes"),
```

Run: `npx drizzle-kit generate --name task_estimate`
Expected: `drizzle/0009_task_estimate.sql` containing `ALTER TABLE \`tasks\` ADD \`estimate_minutes\` integer;` and `drizzle/meta/0009_snapshot.json`.

- [ ] **Step 2: Failing tests for the estimate in the domain, validation and serializer**

Append to `src/domain/tasks/index.test.ts` (inside the existing `describe`, using its `t.db` fixture):

```ts
  it("stores, updates, clears, and bounds an estimate", () => {
    const task = createTask(t.db, { title: "Write", estimateMinutes: 25 });
    expect(task.estimateMinutes).toBe(25);
    expect(updateTask(t.db, task.id, { estimateMinutes: 90 }).estimateMinutes).toBe(90);
    expect(updateTask(t.db, task.id, { estimateMinutes: null }).estimateMinutes).toBeNull();
    expect(() => updateTask(t.db, task.id, { estimateMinutes: 3 })).toThrow(/5 and 480/);
    expect(() => createTask(t.db, { title: "x", estimateMinutes: 481 })).toThrow(/5 and 480/);
  });
```

Append to `src/app/api/tasks.test.ts`:

```ts
  it("accepts an estimate on create and patch, rejects one out of bounds", async () => {
    const a = await r.tasks.POST(json("POST", "/api/tasks", { title: "Est", estimateMinutes: 45 }));
    expect(((await a.json()) as { estimateMinutes: number }).estimateMinutes).toBe(45);
    const id = ((await a.json().catch(() => null)) ?? { id: 0 }) as { id: number }; // re-read below
    const list = (await (await r.tasks.GET(json("GET", "/api/tasks"))).json()) as { tasks: { id: number; title: string; estimateMinutes: number | null }[] };
    const est = list.tasks.find((t) => t.title === "Est")!;
    expect(est.estimateMinutes).toBe(45);
    expect((await r.task.PATCH(json("PATCH", `/api/tasks/${est.id}`, { estimateMinutes: 600 }), params(est.id))).status).toBe(400);
    const cleared = await r.task.PATCH(json("PATCH", `/api/tasks/${est.id}`, { estimateMinutes: null }), params(est.id));
    expect(((await cleared.json()) as { estimateMinutes: number | null }).estimateMinutes).toBeNull();
    void id;
  });
```

(Drop the two `id` lines if the response body was already consumed; the list lookup is what the test relies on.)

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/domain/tasks/index.test.ts src/app/api/tasks.test.ts`
Expected: FAIL on `estimateMinutes` being undefined / unknown key.

- [ ] **Step 4: Implement the estimate**

`src/domain/tasks/index.ts`: add `estimateMinutes?: number | null` to both `CreateTaskInput` and `UpdateTaskInput`; add

```ts
const ESTIMATE_MIN = 5;
const ESTIMATE_MAX = 480;
function checkEstimate(n: number | null | undefined): void {
  if (n == null) return;
  if (!Number.isInteger(n) || n < ESTIMATE_MIN || n > ESTIMATE_MAX) throw new TaskError(`An estimate is between ${ESTIMATE_MIN} and ${ESTIMATE_MAX} minutes`, 400);
}
```

In `createTask` call `checkEstimate(input.estimateMinutes)` and insert `estimateMinutes: input.estimateMinutes ?? null`; in `updateTask` add `if (patch.estimateMinutes !== undefined) { checkEstimate(patch.estimateMinutes); set.estimateMinutes = patch.estimateMinutes; }`.

`src/lib/validation.ts`: in `TaskBody` add `estimateMinutes: z.number().int().min(5).max(480).nullable().optional(),` (PatchTaskBody inherits it through `.partial()`).

`src/lib/api.ts` `serializeTask`: add `estimateMinutes: t.estimateMinutes,`. `src/lib/dto.ts` `TaskDTO`: add `estimateMinutes: number | null;`. Fix every test fixture that builds a `TaskDTO` literal by adding `estimateMinutes: null` (grep `sourceItemId: ` in `src/components/**/*.test.tsx` and `src/lib/*.test.ts`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/domain/tasks src/app/api/tasks.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Failing tests for the `~` estimate suffix**

Append to `src/domain/tasks/quick-parse.test.ts`:

```ts
  it("reads a trailing ~ estimate in minutes or hours and strips it from the title", () => {
    const now = new Date("2026-09-23T09:00:00");
    expect(quickParse("Write the note ~25m", now)).toMatchObject({ title: "Write the note", estimateMinutes: 25 });
    expect(quickParse("Deep work ~1h", now)).toMatchObject({ title: "Deep work", estimateMinutes: 60 });
    expect(quickParse("Deep work ~1h30m", now)).toMatchObject({ title: "Deep work", estimateMinutes: 90 });
    expect(quickParse("Call Ada tomorrow ~15m", now)).toMatchObject({ title: "Call Ada", estimateMinutes: 15 });
    expect(quickParse("Call Ada ~15m tomorrow", now)).toMatchObject({ title: "Call Ada", estimateMinutes: 15 });
    expect(quickParse("Tilde ~ alone", now)).toMatchObject({ title: "Tilde ~ alone", estimateMinutes: null });
    expect(quickParse("Too long ~9h", now)).toMatchObject({ title: "Too long ~9h", estimateMinutes: null });
    expect(quickParse("Plain", now).estimateMinutes).toBeNull();
  });
```

Append to `src/lib/intent.test.ts`:

```ts
  it("carries the estimate on a task intent", () => {
    expect(detectIntent("+ Write ~25m")).toMatchObject({ kind: "task", title: "Write", estimateMinutes: 25 });
  });
```

- [ ] **Step 7: Run them to see them fail**

Run: `npx vitest run src/domain/tasks/quick-parse.test.ts src/lib/intent.test.ts`
Expected: FAIL (`estimateMinutes` undefined).

- [ ] **Step 8: Implement the suffix**

`src/domain/tasks/quick-parse.ts`: the return type gains `estimateMinutes: number | null`. Before the due-date pass, pull an estimate token from anywhere in the title:

```ts
/** `~25m`, `~1h`, `~1h30m`: one token, anywhere, at most 8 hours. */
const ESTIMATE_RE = /(?:^|\s)~(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?=\s|$)/i;

export function estimateFromToken(text: string): { title: string; estimateMinutes: number | null } {
  const m = text.match(ESTIMATE_RE);
  if (!m || (m[1] === undefined && m[2] === undefined)) return { title: text, estimateMinutes: null };
  const minutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  if (minutes < 5 || minutes > 480) return { title: text, estimateMinutes: null };
  const title = (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
  return { title, estimateMinutes: minutes };
}
```

In `quickParse`, after the leading `!` handling: `const est = estimateFromToken(title); title = est.title;` and return `estimateMinutes: est.estimateMinutes`. `src/lib/intent.ts`: the task variant gains `estimateMinutes: number | null` and `detectIntent` passes `parsed.estimateMinutes`. `src/components/shell/prompt-bar.tsx` line ~141: add `estimateMinutes: current.estimateMinutes` to the posted body. `src/components/tasks/task-list.tsx` uses `quickParse` for its inline add: pass `estimateMinutes` through to its POST body too.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/domain/tasks src/lib/intent.test.ts src/components/shell src/components/tasks`
Expected: PASS.

- [ ] **Step 10: Failing tests for capacity arithmetic**

Create `src/lib/capacity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { capacityTone, formatMinutes, freeMinutes, parseWorkHours, plannedMinutes } from "./capacity";

const DAY = "2026-09-23";
const m = (start: string, end: string, over: Partial<{ allDay: boolean; status: string }> = {}) => ({
  startsAt: `${DAY}T${start}:00`,
  endsAt: `${DAY}T${end}:00`,
  allDay: false,
  status: "accepted",
  ...over,
});

describe("capacity", () => {
  it("parses working hours and rejects nonsense", () => {
    expect(parseWorkHours("09:00-18:00")).toEqual({ start: 540, end: 1080 });
    expect(parseWorkHours("9:00-18:00")).toBeNull();
    expect(parseWorkHours("18:00-09:00")).toBeNull();
    expect(parseWorkHours("09:00-24:30")).toBeNull();
  });

  it("subtracts meetings inside the hours, merging overlaps and clipping to the edges", () => {
    expect(freeMinutes([], "09:00-18:00", DAY)).toBe(540);
    expect(freeMinutes([m("10:00", "10:30")], "09:00-18:00", DAY)).toBe(510);
    expect(freeMinutes([m("10:00", "11:00"), m("10:30", "11:30")], "09:00-18:00", DAY)).toBe(450);
    expect(freeMinutes([m("08:00", "09:30"), m("17:30", "19:00")], "09:00-18:00", DAY)).toBe(480);
    expect(freeMinutes([m("07:00", "08:00")], "09:00-18:00", DAY)).toBe(540);
  });

  it("ignores all-day and declined meetings and meetings on other days", () => {
    expect(freeMinutes([m("00:00", "23:59", { allDay: true }), m("10:00", "11:00", { status: "declined" })], "09:00-18:00", DAY)).toBe(540);
    expect(freeMinutes([{ ...m("10:00", "11:00"), startsAt: "2026-09-24T10:00:00", endsAt: "2026-09-24T11:00:00" }], "09:00-18:00", DAY)).toBe(540);
  });

  it("sums open estimates and counts the unestimated", () => {
    expect(
      plannedMinutes([
        { status: "open", estimateMinutes: 25 },
        { status: "open", estimateMinutes: null },
        { status: "done", estimateMinutes: 60 },
        { status: "open", estimateMinutes: 45 },
      ]),
    ).toEqual({ planned: 70, unestimated: 1 });
  });

  it("formats minutes the way the header reads them", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(130)).toBe("2h 10m");
  });

  it("tones the plan against the free time", () => {
    expect(capacityTone(200, 300)).toBe("ok");
    expect(capacityTone(300, 300)).toBe("ok");
    expect(capacityTone(301, 300)).toBe("warn");
    expect(capacityTone(376, 300)).toBe("danger");
    expect(capacityTone(0, 0)).toBe("ok");
    expect(capacityTone(30, 0)).toBe("danger");
  });
});
```

- [ ] **Step 11: Run it to see it fail**

Run: `npx vitest run src/lib/capacity.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 12: Implement `src/lib/capacity.ts`**

```ts
/** The pieces of a meeting capacity needs; both MeetingListDTO and CalendarEvent satisfy it. */
export type CapacityMeeting = { startsAt: string; endsAt: string; allDay: boolean; status: string };

const HOURS_RE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

/** "09:00-18:00" as minutes from midnight, or null when it is not a sane range. */
export function parseWorkHours(s: string): { start: number; end: number } | null {
  const m = s.match(HOURS_RE);
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start < end ? { start, end } : null;
}

/** Minutes from local midnight of `date` to the timestamp; timestamps are local ISO strings. */
function minutesInto(date: string, iso: string): number {
  return (new Date(iso).getTime() - new Date(`${date}T00:00:00`).getTime()) / 60_000;
}

/**
 * Working minutes not taken by timed meetings. Overlapping meetings are merged first so a
 * double booking is not subtracted twice; a meeting spilling past the hours only costs the
 * part inside them.
 */
export function freeMinutes(meetings: CapacityMeeting[], workHours: string, date: string): number {
  const hours = parseWorkHours(workHours);
  if (!hours) return 0;
  const busy = meetings
    .filter((m) => !m.allDay && m.status !== "declined")
    .map((m) => ({ start: Math.max(hours.start, minutesInto(date, m.startsAt)), end: Math.min(hours.end, minutesInto(date, m.endsAt)) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  let taken = 0;
  let cursor = -Infinity;
  for (const b of busy) {
    const start = Math.max(b.start, cursor);
    if (b.end > start) taken += b.end - start;
    cursor = Math.max(cursor, b.end);
  }
  return hours.end - hours.start - taken;
}

/** Open tasks' estimates added up, and how many open tasks carry none. */
export function plannedMinutes(tasks: { status: string; estimateMinutes: number | null }[]): { planned: number; unestimated: number } {
  let planned = 0;
  let unestimated = 0;
  for (const t of tasks) {
    if (t.status !== "open") continue;
    if (t.estimateMinutes == null) unestimated += 1;
    else planned += t.estimateMinutes;
  }
  return { planned, unestimated };
}

export function formatMinutes(n: number): string {
  const total = Math.max(0, Math.round(n));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Fine up to the free time, warn past it, danger past a quarter over. */
export function capacityTone(planned: number, free: number): "ok" | "warn" | "danger" {
  if (planned <= free) return "ok";
  if (free === 0) return "danger";
  return planned > free * 1.25 ? "danger" : "warn";
}
```

- [ ] **Step 13: Run the tests**

Run: `npx vitest run src/lib/capacity.test.ts`
Expected: PASS.

- [ ] **Step 14: Failing test for the working-hours setting and route**

Create `src/app/api/settings-planner.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { planner: typeof import("./settings/planner/route") };
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { planner: await import("./settings/planner/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("planner settings api", () => {
  it("defaults to nine to six, accepts a sane range, rejects the rest", async () => {
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "09:00-18:00" });
    const ok = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "08:30-17:00" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ workHours: "08:30-17:00" });
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "17:00-08:30" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "nine to five" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { nope: 1 }))).status).toBe(400);
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "08:30-17:00" });
  });
});
```

- [ ] **Step 15: Run it to see it fail**

Run: `npx vitest run src/app/api/settings-planner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 16: Implement the setting and route**

`src/lib/work-hours.ts`:

```ts
import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { TaskError } from "@/domain/tasks";
import { parseWorkHours } from "./capacity";

export const WORK_HOURS_KEY = "planner.workHours";
export const DEFAULT_WORK_HOURS = "09:00-18:00";

export function getWorkHours(db: DB): string {
  const value = getSetting(db, WORK_HOURS_KEY, DEFAULT_WORK_HOURS);
  return parseWorkHours(value) ? value : DEFAULT_WORK_HOURS;
}

export function setWorkHours(db: DB, value: string): string {
  if (!parseWorkHours(value)) throw new TaskError("Hours must be HH:MM-HH:MM with the start before the end", 400);
  setSetting(db, WORK_HOURS_KEY, value);
  return value;
}
```

`src/app/api/settings/planner/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api";
import { getWorkHours, setWorkHours } from "@/lib/work-hours";

export const dynamic = "force-dynamic";
const Body = z.object({ workHours: z.string().max(11) }).strict();

/** The working hours capacity is measured against. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ workHours: getWorkHours(getDb()) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json({ workHours: setWorkHours(getDb(), parsed.data.workHours) });
  } catch (err) {
    return errorResponse(err);
  }
}
```

(`errorResponse` maps `TaskError` to its status; check `src/lib/api.ts` and, if it only knows some error classes, add `TaskError` the same way.)

- [ ] **Step 17: Run the test**

Run: `npx vitest run src/app/api/settings-planner.test.ts`
Expected: PASS.

- [ ] **Step 18: Failing tests for the sources and capacity payloads**

Append to `src/lib/planner.test.ts` (follow the file's existing fixture: it builds `t = makeTestDb()` and creates containers/tasks; use `createContainer`, `createTask`, `addToPlan`, `replaceCalendarEvents` the way the neighbouring tests do):

```ts
  it("groups every open task by where it lives and marks the day's capacity", () => {
    const project = createContainer(t.db, { kind: "project", name: "Launch" });
    const area = createContainer(t.db, { kind: "area", name: "Health" });
    const empty = createContainer(t.db, { kind: "project", name: "Idle" });
    const inbox = createTask(t.db, { title: "Loose", estimateMinutes: 25 });
    const late = createTask(t.db, { title: "Late", dueDate: "2026-09-20", containerId: project.id });
    const todayTask = createTask(t.db, { title: "Today", dueDate: "2026-09-23", containerId: area.id, estimateMinutes: 45 });
    const planned = createTask(t.db, { title: "Planned", containerId: project.id, estimateMinutes: 60 });
    addToPlan(t.db, "2026-09-23", planned.id);
    addToPlan(t.db, "2026-09-23", todayTask.id);
    replaceCalendarEvents(t.db, [
      { externalId: "m1", title: "Sync", startsAt: "2026-09-23T10:00:00", endsAt: "2026-09-23T11:00:00", attendees: 2, hasCallLink: true },
    ]);
    const day = plannerDay(t.db, "2026-09-23");
    expect(day.sources.inbox.map((x) => x.id)).toEqual([inbox.id]);
    expect(day.sources.due.overdue.map((x) => x.id)).toEqual([late.id]);
    expect(day.sources.due.today).toEqual([]); // already planned
    expect(day.sources.projects.map((g) => [g.container.name, g.tasks.length])).toEqual([["Launch", 2], ["Idle", 0]]);
    expect(day.sources.areas.map((g) => [g.container.name, g.tasks.map((x) => x.id)])).toEqual([["Health", [todayTask.id]]]);
    expect(day.capacity).toEqual({ freeMinutes: 480, plannedMinutes: 105, unestimated: 0, workHours: "09:00-18:00" });
    void empty;
    const week = plannerWeek(t.db, "2026-09-21");
    expect(week.days[2].capacity).toEqual({ freeMinutes: 480, plannedMinutes: 105 });
    expect(week.days[0].capacity).toEqual({ freeMinutes: 540, plannedMinutes: 0 });
  });
```

- [ ] **Step 19: Run it to see it fail**

Run: `npx vitest run src/lib/planner.test.ts`
Expected: FAIL (`sources` undefined).

- [ ] **Step 20: Implement the payloads**

`src/lib/dto.ts`: add

```ts
export interface SourceGroupDTO {
  container: ContainerDTO;
  tasks: TaskDTO[];
}

/** Every open task, by where it lives, for the planning drawer. */
export interface PlannerSourcesDTO {
  inbox: TaskDTO[];
  due: { overdue: TaskDTO[]; today: TaskDTO[] };
  projects: SourceGroupDTO[];
  areas: SourceGroupDTO[];
}

export interface CapacityDTO {
  freeMinutes: number;
  plannedMinutes: number;
  unestimated: number;
  workHours: string;
}
```

`PlannerDayDTO` gains `sources: PlannerSourcesDTO;` and `capacity: CapacityDTO;`. `PlannerWeekDayDTO` gains `capacity: { freeMinutes: number; plannedMinutes: number };`.

`src/lib/planner.ts`:

```ts
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "./api";
import { freeMinutes, plannedMinutes } from "./capacity";
import { getWorkHours } from "./work-hours";

/** Open tasks grouped by home: inbox (no container), then every active project and area. */
export function plannerSources(db: DB, date: string, plannedIds: Set<number>): PlannerSourcesDTO {
  const open = listTasks(db, { status: "open" }).map(serializeTask);
  const unplanned = open.filter((t) => !plannedIds.has(t.id));
  const groups = (kind: "project" | "area"): SourceGroupDTO[] => {
    const containers = serializeContainers(db, listContainers(db, { kind, status: "active" }));
    return containers
      .map((container) => ({ container, tasks: open.filter((t) => t.containerId === container.id) }))
      .sort((a, b) => (b.tasks.length > 0 ? 1 : 0) - (a.tasks.length > 0 ? 1 : 0));
  };
  return {
    inbox: open.filter((t) => t.containerId === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    due: partitionDue(unplanned.filter((t) => t.dueDate !== null && t.dueDate <= date), date),
    projects: groups("project"),
    areas: groups("area"),
  };
}
```

(`listTasks` without a container filter returns every task; confirm it does not default to the inbox. The sort keeps containers' own order and only moves empty groups last: a stable sort by "has tasks".) Note the Inbox and the groups list every open task including planned ones; the drawer dims planned rows using the plan's ids. `due` excludes planned tasks, as the plan pane does today.

In `plannerDay`: compute `const workHours = getWorkHours(db)`, `const meetings = plannerMeetings(...)`, `const { planned, unestimated } = plannedMinutes(plan)` and return additionally `sources: plannerSources(db, date, planned)` (the `Set` of plan ids already built as `planned`; rename the set to `plannedIds` to avoid the clash) and `capacity: { freeMinutes: freeMinutes(meetings, workHours, date), plannedMinutes: planned, unestimated, workHours }`. Keep `due` as it is.

In `plannerWeek`: read `workHours` once; for each date compute `capacity: { freeMinutes: freeMinutes(meetings, workHours, date), plannedMinutes: plannedMinutes(listPlan(db, date)).planned }` (import `listPlan` from `@/domain/plan`).

- [ ] **Step 21: Run the tests, lint, types**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green (fix any `PlannerDayDTO` fixtures in component tests by adding `sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] }` and `capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" }`, and `capacity: { freeMinutes: 540, plannedMinutes: 0 }` on week-day fixtures).

- [ ] **Step 22: Commit**

```bash
git add -A drizzle src
git commit -m "feat(planner): task estimates, working hours, capacity arithmetic, sources payload

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Sources drawer and dropping into the plan

**Files:**
- Create: `src/components/planner/sources-drawer.tsx`, `src/components/planner/sources-drawer.test.tsx`, `src/components/planner/use-drawer-tab.ts`
- Modify: `src/components/planner/day-view.tsx`, `src/components/planner/plan-pane.tsx`, `src/components/planner/plan-pane.test.tsx`
- Test: as above

**Interfaces:**
- Consumes: `PlannerDayDTO.sources`, `PlannerDayDTO.plan`, `TaskRow` (`compact`, `draggable`, `onDragStart`, `onPlan`, `planned`), `POST/DELETE/PATCH /api/plan`, events `sb:plan-changed`, `sb:tasks-changed`.
- Produces: `SourcesDrawer({ day, today, onRefresh })`; window events `sb:planner-drawer` (`CustomEvent<{ tab?: DrawerTab; focus?: boolean; toggle?: boolean }>`) that Task 4's ritual and the `⌘/` handler send; drag MIME `application/x-sb-task` carrying the task id (the plan list and the drawer both use it); `DrawerTab = "inbox" | "due" | "projects" | "areas" | "search"`; `localStorage` key `sb:planner-source-tab`.

- [ ] **Step 1: Failing drawer tests**

Create `src/components/planner/sources-drawer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import type { PlannerDayDTO, TaskDTO, ContainerDTO } from "@/lib/dto";
import { SourcesDrawer } from "./sources-drawer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/planner" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

const TODAY = "2026-09-23";
let nextId = 1;
function task(over: Partial<TaskDTO> & { title: string }): TaskDTO {
  return {
    id: nextId++, notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
    completedAt: null, sortOrder: 0, estimateMinutes: null, createdAt: "2026-09-22T09:00:00.000Z", updatedAt: "2026-09-22T09:00:00.000Z", ...over,
  };
}
function container(id: number, kind: "project" | "area", name: string): ContainerDTO {
  return { id, kind, name, slug: name.toLowerCase(), description: "", status: "active", goal: "", deadline: null } as ContainerDTO;
}
const launch = container(10, "project", "Launch");
const health = container(11, "area", "Health");
const loose = task({ title: "Loose one" });
const late = task({ title: "Late one", dueDate: "2026-09-20", containerId: 10 });
const ship = task({ title: "Ship it", containerId: 10 });
const walk = task({ title: "Walk", containerId: 11 });
const planned = task({ title: "Already planned", containerId: 10 });

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [{ ...planned, planId: 1 }],
    unfinishedYesterday: [],
    due: { overdue: [late], today: [] },
    meetings: [],
    calendar: { calendarsSeen: 1, permission: true },
    sources: { inbox: [loose], due: { overdue: [late], today: [] }, projects: [{ container: launch, tasks: [late, ship, planned] }], areas: [{ container: health, tasks: [walk] }] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
    ...over,
  };
}

function stubPlan() {
  const posts: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({});
    }),
  );
  return posts;
}

describe("SourcesDrawer", () => {
  it("opens on Due when something is due, counts each tab, and adds a task to the plan", async () => {
    const posts = stubPlan();
    const onRefresh = vi.fn();
    render(<SourcesDrawer day={day()} today={TODAY} onRefresh={onRefresh} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Inbox 1", "Due 1", "Projects 2", "Areas 1", "Search"]);
    expect(screen.getByRole("tab", { name: /Due/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Plan Late one for today" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: "/api/plan", method: "POST", body: { date: TODAY, taskId: late.id } }));
  });

  it("dims a planned row and unplans it from its check", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day({ sources: { ...day().sources, due: { overdue: [], today: [] } } })} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const row = screen.getByText("Already planned").closest("li")!;
    expect(row.className).toMatch(/opacity/);
    fireEvent.click(within(row).getByRole("button", { name: "Take Already planned off the plan" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: "/api/plan", method: "DELETE", body: { date: TODAY, taskId: planned.id } }));
  });

  it("groups projects with empty ones last and collapsed", () => {
    stubPlan();
    const idle = container(12, "project", "Idle");
    const d = day();
    d.sources.projects = [{ container: idle, tasks: [] }, ...d.sources.projects];
    render(<SourcesDrawer day={d} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.querySelector("summary")?.textContent)).toEqual(["Launch3", "Idle0"]);
    expect((groups[1] as HTMLDetailsElement).open).toBe(false);
  });

  it("searches every open task and groups hits by home", () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Search" }));
    expect(screen.getByText("Type to search every open task")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "one" } });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Loose one"), expect.stringContaining("Late one")]));
    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("Launch")).toBeTruthy();
  });

  it("remembers the tab, and switches on the drawer event", async () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Areas/ }));
    cleanup();
    render(<SourcesDrawer day={day()} today={TODAY} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Areas/ }).getAttribute("aria-selected")).toBe("true"));
    window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects", focus: true } }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Projects/ }).getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement?.textContent).toContain("Late one");
  });

  it("plans on Enter and moves focus to the next row", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const first = screen.getByRole("button", { name: "Plan Late one for today" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Plan Ship it for today");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/planner/sources-drawer.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the stored tab hook**

`src/components/planner/use-drawer-tab.ts`:

```ts
import { useEffect, useState } from "react";

export type DrawerTab = "inbox" | "due" | "projects" | "areas" | "search";
export const TAB_KEY = "sb:planner-source-tab";
const TABS: DrawerTab[] = ["inbox", "due", "projects", "areas", "search"];

function stored(): DrawerTab | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.includes(v as DrawerTab) ? (v as DrawerTab) : null;
  } catch {
    return null;
  }
}

/**
 * The active tab: the browser's remembered one once it has been read, else the fallback the
 * day suggests. Reading storage happens in an effect so the server and the first client
 * render agree, and the async setState keeps the react-compiler rule happy.
 */
export function useDrawerTab(fallback: DrawerTab): [DrawerTab, (tab: DrawerTab) => void] {
  const [tab, setTabState] = useState<DrawerTab>(fallback);
  useEffect(() => {
    const remembered = stored();
    if (remembered) queueMicrotask(() => setTabState(remembered));
  }, []);
  function setTab(next: DrawerTab) {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* private mode: the tab just resets next time */
    }
  }
  return [tab, setTab];
}
```

- [ ] **Step 4: Implement the drawer**

`src/components/planner/sources-drawer.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, Plus } from "lucide-react";
import type { PlannerDayDTO, SourceGroupDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { Chip, Input, List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { useDrawerTab, type DrawerTab } from "./use-drawer-tab";

export const TASK_DRAG_MIME = "application/x-sb-task";
const JSON_HEADERS = { "content-type": "application/json" };
const TABS: { id: DrawerTab; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "due", label: "Due" },
  { id: "projects", label: "Projects" },
  { id: "areas", label: "Areas" },
  { id: "search", label: "Search" },
];

interface Props {
  day: PlannerDayDTO;
  today: string;
  onRefresh: () => void;
}

/** The day's own name in the add button: "today" on today, the date otherwise. */
function dayWord(date: string, today: string): string {
  return date === today ? "today" : date;
}

/**
 * Every open task by where it lives, one click or one drag away from the plan. Rows are the
 * app's task rows in their compact form with an add button in front; a planned task keeps
 * its row, dimmed, with a check that takes it off again.
 */
export function SourcesDrawer({ day, today, onRefresh }: Props) {
  const { sources } = day;
  const dueCount = sources.due.overdue.length + sources.due.today.length;
  const [tab, setTab] = useDrawerTab(dueCount > 0 ? "due" : "inbox");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const plannedIds = useMemo(() => new Set(day.plan.map((t) => t.id)), [day.plan]);

  useEffect(() => {
    function onDrawer(e: Event) {
      const detail = (e as CustomEvent<{ tab?: DrawerTab; focus?: boolean }>).detail ?? {};
      if (detail.tab) setTab(detail.tab);
      if (detail.focus) {
        // The rows exist after the tab renders; a frame later is soon enough.
        requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>("button[data-plan]")?.focus());
      }
    }
    window.addEventListener("sb:planner-drawer", onDrawer);
    return () => window.removeEventListener("sb:planner-drawer", onDrawer);
  }, [setTab]);

  async function send(method: "POST" | "DELETE", taskId: number) {
    const res = await fetch("/api/plan", { method, headers: JSON_HEADERS, body: JSON.stringify({ date: day.date, taskId }) });
    if (!res.ok) {
      setError("Could not change the plan");
      return;
    }
    setError(null);
    window.dispatchEvent(new Event("sb:plan-changed"));
    onRefresh();
  }
  const patch = async (id: number, body: Record<string, unknown>) => {
    const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (res.ok) window.dispatchEvent(new Event("sb:tasks-changed"));
    else setError("Could not save that change");
  };

  function onAddKey(e: KeyboardEvent<HTMLButtonElement>, taskId: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-plan]") ?? []);
    const next = buttons[buttons.indexOf(e.currentTarget) + 1];
    void send("POST", taskId);
    next?.focus();
  }

  function row(task: TaskDTO) {
    const planned = plannedIds.has(task.id);
    const word = dayWord(day.date, today);
    return (
      <div key={task.id} className={`flex items-start gap-1 ${planned ? "opacity-50" : ""}`}>
        <button
          type="button"
          data-plan
          aria-label={planned ? `Take ${task.title} off the plan` : `Plan ${task.title} for ${word}`}
          className={`focus-ring shrink-0 mt-1.5 w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-100 ${
            planned ? "bg-violet text-on-violet" : "border border-hairline text-fg-muted hover:text-fg hover:border-hairline-strong"
          }`}
          onClick={() => void send(planned ? "DELETE" : "POST", task.id)}
          onKeyDown={(e) => !planned && onAddKey(e, task.id)}
        >
          {planned ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Plus className="w-3.5 h-3.5" aria-hidden />}
        </button>
        <div className="flex-1 min-w-0">
          <TaskRow
            task={task}
            today={today}
            compact
            planned={planned}
            draggable={!planned}
            onDragStart={(e: DragEvent<HTMLLIElement>) => {
              e.dataTransfer.setData(TASK_DRAG_MIME, String(task.id));
              e.dataTransfer.effectAllowed = "move";
            }}
            onToggle={() => void patch(task.id, { status: task.status === "done" ? "open" : "done" })}
            onRename={(title) => void patch(task.id, { title })}
            onDue={(value) => void patch(task.id, { dueDate: value })}
            onPriority={(priority: TaskPriority) => void patch(task.id, { priority })}
            onDrop={() => void patch(task.id, { status: "dropped" })}
            onDelete={() => void fetch(`/api/tasks/${task.id}`, { method: "DELETE" }).then(() => window.dispatchEvent(new Event("sb:tasks-changed")))}
            onPlan={() => void send(planned ? "DELETE" : "POST", task.id)}
            planLabel={day.date === today ? undefined : "Plan for this day"}
          />
        </div>
      </div>
    );
  }

  function groups(list: SourceGroupDTO[], emptyText: string) {
    if (list.length === 0) return <p className="text-[13px] text-fg-faint m-0 px-1">{emptyText}</p>;
    return list.map((g) => (
      <details key={g.container.id} role="group" open={g.tasks.length > 0} className="flex flex-col gap-1">
        <summary className="focus-ring cursor-pointer flex items-center gap-2 rounded-sm px-1 py-1">
          <span className="font-doc text-[15px] text-fg">{g.container.name}</span>
          <span className="font-mono text-[11px] text-fg-faint">{g.tasks.length}</span>
        </summary>
        {g.tasks.length > 0 && <List>{g.tasks.map(row)}</List>}
      </details>
    ));
  }

  function searchResults() {
    const q = query.trim().toLowerCase();
    if (!q) return <p className="text-[13px] text-fg-faint m-0 px-1">Type to search every open task</p>;
    const homes: { name: string; tasks: TaskDTO[] }[] = [
      { name: "Inbox", tasks: sources.inbox },
      ...sources.projects.map((g) => ({ name: g.container.name, tasks: g.tasks })),
      ...sources.areas.map((g) => ({ name: g.container.name, tasks: g.tasks })),
    ]
      .map((h) => ({ ...h, tasks: h.tasks.filter((t) => t.title.toLowerCase().includes(q)) }))
      .filter((h) => h.tasks.length > 0);
    if (homes.length === 0) return <p className="text-[13px] text-fg-faint m-0 px-1">Nothing matches</p>;
    return homes.map((h) => (
      <div key={h.name} className="flex flex-col gap-1">
        <span className="micro px-1">{h.name}</span>
        <List>{h.tasks.map(row)}</List>
      </div>
    ));
  }

  function body() {
    switch (tab) {
      case "inbox":
        return sources.inbox.length ? <List>{sources.inbox.map(row)}</List> : <p className="text-[13px] text-fg-faint m-0 px-1">Nothing in the inbox</p>;
      case "due": {
        const due = [...sources.due.overdue, ...sources.due.today];
        return due.length ? <List>{due.map(row)}</List> : <p className="text-[13px] text-fg-faint m-0 px-1">Nothing due</p>;
      }
      case "projects":
        return groups(sources.projects, "No active projects");
      case "areas":
        return groups(sources.areas, "No active areas");
      case "search":
        return (
          <>
            <Input type="search" size="sm" aria-label="Search open tasks" placeholder="Search open tasks" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            {searchResults()}
          </>
        );
    }
  }

  const counts: Record<DrawerTab, number | null> = {
    inbox: sources.inbox.length,
    due: dueCount,
    projects: sources.projects.length,
    areas: sources.areas.length,
    search: null,
  };

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length].id);
    else if (e.key === "ArrowLeft") setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
    else return;
    e.preventDefault();
    requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
  }

  return (
    <aside
      className="pane p-3 flex flex-col gap-3 min-h-[240px]"
      aria-label="Sources"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-sb-plan")) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData("application/x-sb-plan"));
        if (id) void send("DELETE", id);
      }}
    >
      <div role="tablist" aria-label="Sources" className="flex items-center gap-1 flex-wrap" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <Chip key={t.id} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {counts[t.id] !== null && <span className="font-mono text-[11px] text-fg-faint">{counts[t.id]}</span>}
          </Chip>
        ))}
      </div>
      <div ref={listRef} className="flex flex-col gap-2">
        {body()}
      </div>
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </aside>
  );
}
```

Notes for the implementer: `Chip` must forward `role`, `aria-selected`, `tabIndex` and `onClick` to its `<button>` (it spreads props already; verify). The `TaskRow` in compact mode renders an `<li>` with the title; the tests locate rows by `closest("li")` and the add button by label. The plan pane's own rows set the second MIME `application/x-sb-plan` when dragged (Step 6) so a plan row dropped on the drawer unplans.

- [ ] **Step 5: Run the drawer tests**

Run: `npx vitest run src/components/planner/sources-drawer.test.tsx`
Expected: PASS.

- [ ] **Step 6: Failing plan-pane tests for the drop target and the moved Due section**

In `src/components/planner/plan-pane.test.tsx` add (reuse its `day()` fixture, adding `sources` and `capacity` if the fixture lacks them):

```tsx
  it("no longer lists due tasks itself", () => {
    render(<PlanPane day={day({ due: { overdue: [late], today: [] } })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.queryByText("Due")).toBeNull();
    expect(screen.queryByText("Late one")).toBeNull();
  });

  it("accepts a dragged task at the end and between rows", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...a, planId: 1 }, { ...b, planId: 2 }] })} today={TODAY} onRefresh={vi.fn()} />);
    const dt = { types: ["application/x-sb-task"], getData: () => String(c.id), setData: vi.fn(), effectAllowed: "move", dropEffect: "move" };
    const list = screen.getByRole("list", { name: "Plan" });
    fireEvent.dragOver(list, { dataTransfer: dt });
    expect(list.className).toMatch(/border-violet/);
    fireEvent.drop(screen.getByText(b.title).closest("li")!, { dataTransfer: dt });
    await waitFor(() => expect(posts.map((p) => [p.method, p.body])).toEqual([
      ["POST", { date: TODAY, taskId: c.id }],
      ["PATCH", { date: TODAY, taskIds: [a.id, c.id, b.id] }],
    ]));
  });
```

(`a`, `b`, `c` are task fixtures; `stubPlan` records posts as in the drawer test. Copy both helpers into this file rather than importing across tests.)

- [ ] **Step 7: Run to see them fail**

Run: `npx vitest run src/components/planner/plan-pane.test.tsx`
Expected: FAIL (Due still rendered; no drop handling).

- [ ] **Step 8: Change the plan pane and the day view**

`plan-pane.tsx`:
- Delete the `Due` heading and list and the `due` constant; keep the carry-over banner.
- Give the plan's `<List>` an `aria-label="Plan"`, an `onDragOver` that calls `preventDefault()` and sets `over` state to `true` when `e.dataTransfer.types.includes(TASK_DRAG_MIME)`, `onDragLeave` clearing it, and `onDrop` that plans at the end; add `border border-transparent rounded-md` and, while `over`, `border-violet`.
- Each plan row's `onRowDrop` receives the event: if it carries `TASK_DRAG_MIME`, insert at that row's index: `await send("/api/plan", "POST", { date, taskId })` then `send("/api/plan", "PATCH", { date, taskIds })` with the new order (the current ids with the new one spliced at the index); otherwise keep the existing reorder-by-drag logic. Make `send` return the response ok-ness so the sequence can stop on failure.
- Plan rows' `onDragStart` additionally sets `e.dataTransfer.setData("application/x-sb-plan", String(task.id))` so the drawer can unplan a row dragged onto it.
- Import `TASK_DRAG_MIME` from `./sources-drawer`.

`day-view.tsx`: three regions:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { IconButton } from "../ui";
import { PlanPane } from "./plan-pane";
import { SourcesDrawer } from "./sources-drawer";
import { Timeline } from "./timeline";

/**
 * Timeline, plan, sources. Above 1280 px the drawer has its own column; between 1100 and 1280
 * it opens over the right edge from a toggle; below that the regions stack with the drawer
 * last, plan first: a phone plans, it does not read a timeline.
 */
export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onDrawer(e: Event) {
      if ((e as CustomEvent<{ toggle?: boolean; tab?: string }>).detail?.toggle) setOpen((v) => !v);
      else if ((e as CustomEvent<{ tab?: string }>).detail?.tab) setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("sb:planner-drawer", onDrawer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sb:planner-drawer", onDrawer);
    };
  }, []);

  const drawer = <SourcesDrawer day={day} today={today} onRefresh={onRefresh} />;
  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[3fr_2fr] min-[1280px]:grid-cols-[5fr_4fr_4fr] gap-6 items-start">
      <div className="order-2 min-[1100px]:order-1">
        <Timeline date={day.date} meetings={day.meetings} />
      </div>
      <div className="order-1 min-[1100px]:order-2 flex flex-col gap-3">
        <div className="min-[1280px]:hidden flex justify-end">
          <IconButton label={open ? "Hide sources" : "Show sources"} icon={PanelRight} active={open} onClick={() => setOpen((v) => !v)} />
        </div>
        <PlanPane day={day} today={today} onRefresh={onRefresh} />
      </div>
      <div className="order-3 hidden min-[1280px]:block">{drawer}</div>
      {open && (
        <div className="min-[1280px]:hidden fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] p-4 overflow-y-auto bg-carbon/95 border-l border-hairline" role="dialog" aria-label="Sources">
          {drawer}
        </div>
      )}
    </div>
  );
}
```

(The `⌘/` handler here is the drawer toggle the spec names; on screens wide enough for the third column the toggle has nothing to do, which is fine. Escape closes the overlay: add `if (e.key === "Escape") setOpen(false)` to `onKey`.)

- [ ] **Step 9: Run the planner tests, lint, types**

Run: `npx vitest run src/components/planner && npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(planner): sources drawer beside the plan, drag and one-click planning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Estimates in the row and prompt bar, capacity line, hours chip, week line

**Files:**
- Modify: `src/components/tasks/task-row.tsx` (+ test), `src/components/tasks/task-list.tsx`, `src/components/planner/plan-pane.tsx`, `src/components/planner/week-view.tsx` (+ test), `src/components/planner/sources-drawer.tsx`, `src/components/planner/planner-shell.tsx`, `src/components/planner/date-header.tsx`, `src/components/shell/prompt-bar.tsx` (+ test)
- Create: `src/components/planner/capacity-line.tsx`, `src/components/planner/capacity-line.test.tsx`, `src/components/tasks/estimate-chip.tsx`

**Interfaces:**
- Consumes: `TaskDTO.estimateMinutes`, `PlannerDayDTO.capacity`, `PlannerWeekDayDTO.capacity`, `formatMinutes`, `capacityTone`, `GET/PATCH /api/settings/planner`.
- Produces: `TaskRow` prop `onEstimate?: (minutes: number | null) => void` (chip shown only when provided); `EstimateChip({ value, onChange, compact })`; `CapacityLine({ capacity, planned, meetings })` rendering the header line; `HoursChip({ workHours, onChange })`; `DateHeader.summary` becomes `ReactNode`.

- [ ] **Step 1: Failing tests for the estimate chip on the row**

Append to `src/components/tasks/task-row.test.tsx` (follow its `mount` helper and `task` fixture):

```tsx
describe("TaskRow estimate", () => {
  it("shows the estimate, offers presets and a free field, and clears", () => {
    const onEstimate = vi.fn();
    mount({ task: task({ estimateMinutes: 90 }), onEstimate });
    const chip = screen.getByRole("button", { name: "Estimate 1h 30m" });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "25m" }));
    expect(onEstimate).toHaveBeenLastCalledWith(25);
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1h 30m" }));
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    fireEvent.change(field, { target: { value: "50" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEstimate).toHaveBeenLastCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1h 30m" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No estimate" }));
    expect(onEstimate).toHaveBeenLastCalledWith(null);
  });

  it("reads est when there is none, and hides without a handler", () => {
    mount({ task: task({ estimateMinutes: null }), onEstimate: vi.fn() });
    expect(screen.getByRole("button", { name: "Estimate: none" }).textContent).toBe("est");
    cleanup();
    mount({ task: task({ estimateMinutes: 30 }) });
    expect(screen.queryByRole("button", { name: /Estimate/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/tasks/task-row.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the chip**

`src/components/tasks/estimate-chip.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { formatMinutes } from "@/lib/capacity";

const PRESETS = [15, 25, 45, 60, 90, 120];

/**
 * A mono chip after the due chip: "25m", "1h 30m", or "est" when nobody has guessed. The
 * popover offers the usual sizes and a free field; Enter commits, Escape closes.
 */
export function EstimateChip({ value, onChange, compact }: { value: number | null; onChange: (minutes: number | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(minutes: number | null) {
    onChange(minutes);
    setOpen(false);
    button.current?.focus();
  }
  function commitDraft() {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 5 && n <= 480) pick(n);
  }
  const label = value === null ? "Estimate: none" : `Estimate ${formatMinutes(value)}`;

  return (
    <span className={`relative ${compact ? "self-start" : "shrink-0"}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`focus-ring font-mono text-[11px] rounded-sm px-1 ${value === null ? "text-fg-faint hover:text-fg-muted" : "text-fg-muted hover:text-fg"}`}
        onClick={() => {
          setDraft(value === null ? "" : String(value));
          setOpen((v) => !v);
        }}
      >
        {value === null ? "est" : formatMinutes(value)}
      </button>
      {open && (
        <div ref={panel} role="menu" aria-label="Estimate" className="panel absolute right-0 top-full mt-1 rounded-md p-1 flex flex-col gap-0.5 w-40 z-50" onKeyDown={(e) => e.key === "Escape" && pick(value)}>
          <div className="grid grid-cols-3 gap-0.5">
            {PRESETS.map((m) => (
              <button key={m} type="button" role="menuitemradio" aria-checked={value === m} className={`focus-ring font-mono text-[11.5px] h-7 rounded-sm ${value === m ? "bg-violet-dim text-fg" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`} onClick={() => pick(m)}>
                {formatMinutes(m)}
              </button>
            ))}
          </div>
          <input
            type="number"
            aria-label="Minutes"
            min={5}
            max={480}
            step={5}
            value={draft}
            placeholder="Minutes"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitDraft()}
            className="focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border border-hairline text-fg"
          />
          <button type="button" role="menuitemradio" aria-checked={value === null} className="focus-ring text-[12px] h-7 rounded-sm text-fg-muted hover:text-fg hover:bg-layer-2 text-left px-2" onClick={() => pick(null)}>
            No estimate
          </button>
        </div>
      )}
    </span>
  );
}
```

In `task-row.tsx`: add prop `onEstimate?: (minutes: number | null) => void;` and render `{onEstimate && <EstimateChip value={task.estimateMinutes} onChange={onEstimate} compact={compact} />}` right after the due chip in both layouts (compact and full). Wire `onEstimate={(m) => patch(task.id, { estimateMinutes: m })}` in `task-list.tsx`, `plan-pane.tsx`, `week-view.tsx`, and `sources-drawer.tsx`.

- [ ] **Step 4: Run the row tests**

Run: `npx vitest run src/components/tasks`
Expected: PASS.

- [ ] **Step 5: Failing tests for the capacity line and hours chip**

Create `src/components/planner/capacity-line.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CapacityLine } from "./capacity-line";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { freeMinutes: 270, plannedMinutes: 130, unestimated: 0, workHours: "09:00-18:00" };

describe("CapacityLine", () => {
  it("reads planned against free with the meeting count", () => {
    render(<CapacityLine capacity={base} planned={3} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("3 planned · 2h 10m of 4h 30m free · 4 meetings");
  });

  it("names the unestimated and warns past the free time", () => {
    render(<CapacityLine capacity={{ ...base, plannedMinutes: 300, unestimated: 2 }} planned={5} meetings={1} onHours={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("(2 unestimated)");
    expect(status.querySelector(".text-warn")).toBeTruthy();
    expect(status.getAttribute("title")).toBe("Plan is 30m over the free time");
  });

  it("goes to danger past a quarter over", () => {
    render(<CapacityLine capacity={{ ...base, plannedMinutes: 400 }} planned={5} meetings={1} onHours={vi.fn()} />);
    expect(screen.getByRole("status").querySelector(".text-danger")).toBeTruthy();
  });

  it("edits the hours from the chip", async () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "08:30-17:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onHours).toHaveBeenCalledWith("08:30-17:00"));
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `npx vitest run src/components/planner/capacity-line.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement the capacity line and hours chip**

`src/components/planner/capacity-line.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { CapacityDTO } from "@/lib/dto";
import { capacityTone, formatMinutes, parseWorkHours } from "@/lib/capacity";
import { count } from "./open-meeting";

const TONE_CLASS = { ok: "text-fg-muted", warn: "text-warn", danger: "text-danger" } as const;

interface Props {
  capacity: CapacityDTO;
  /** Tasks on the plan, whatever their estimates. */
  planned: number;
  meetings: number;
  onHours: (workHours: string) => void;
}

/**
 * The Day header's mono line: how much is planned against the time the calendar leaves,
 * and a chip to say what the working hours are.
 */
export function CapacityLine({ capacity, planned, meetings, onHours }: Props) {
  const tone = capacityTone(capacity.plannedMinutes, capacity.freeMinutes);
  const over = capacity.plannedMinutes - capacity.freeMinutes;
  const title = over > 0 ? `Plan is ${formatMinutes(over)} over the free time` : undefined;
  return (
    <span className="flex items-center gap-3 flex-wrap justify-end">
      <span role="status" title={title} className="font-mono text-[12px] text-fg-muted">
        {planned} planned · <span className={TONE_CLASS[tone]}>{formatMinutes(capacity.plannedMinutes)}</span> of {formatMinutes(capacity.freeMinutes)} free
        {capacity.unestimated > 0 && ` (${capacity.unestimated} unestimated)`} · {count(meetings, "meeting")}
      </span>
      <HoursChip workHours={capacity.workHours} onChange={onHours} />
    </span>
  );
}

export function HoursChip({ workHours, onChange }: { workHours: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(workHours);
  const [bad, setBad] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  function commit() {
    if (!parseWorkHours(draft)) {
      setBad(true);
      return;
    }
    setBad(false);
    setOpen(false);
    onChange(draft);
  }
  return (
    <span className="relative">
      <button
        type="button"
        aria-label={`Hours ${workHours}`}
        aria-expanded={open}
        className="focus-ring font-mono text-[11px] text-fg-faint hover:text-fg-muted rounded-sm px-1"
        onClick={() => {
          setDraft(workHours);
          setBad(false);
          setOpen((v) => !v);
        }}
      >
        {workHours}
      </button>
      {open && (
        <div className="panel absolute right-0 top-full mt-1 rounded-md p-2 flex flex-col gap-1 z-50 w-48">
          <label className="text-[11.5px] text-fg-muted" htmlFor="work-hours">
            Working hours
          </label>
          <input
            id="work-hours"
            ref={field}
            type="text"
            value={draft}
            placeholder="09:00-18:00"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={commit}
            className={`focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border ${bad ? "border-danger" : "border-hairline"} text-fg`}
          />
          {bad && <span className="text-[11.5px] text-danger">Use HH:MM-HH:MM, start before end</span>}
        </div>
      )}
    </span>
  );
}
```

`date-header.tsx`: `summary: ReactNode`; render `{summary}` inside the existing span but drop that span's `font-mono` classes when the summary is not a string (simplest: keep the span for strings and render nodes directly: `typeof summary === "string" ? <span className="font-mono text-[12px] text-fg-muted">{summary}</span> : summary`).

`planner-shell.tsx`: for the day header pass `summary={<CapacityLine capacity={day.capacity} planned={day.plan.length} meetings={day.meetings.length} onHours={saveHours} />}` where `saveHours` PATCHes `/api/settings/planner` and on success calls `refreshDay()` (the capacity is recomputed server-side).

`plan-pane.tsx`: under the `Plan` heading add the bar:

```tsx
<div className="h-1 rounded-full bg-layer-2 overflow-hidden" aria-hidden>
  <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_CLASS[tone]}`} style={{ width: `${Math.min(100, capacity.freeMinutes ? (capacity.plannedMinutes / capacity.freeMinutes) * 100 : capacity.plannedMinutes ? 100 : 0)}%` }} />
</div>
```

with `BAR_CLASS = { ok: "bg-violet", warn: "bg-warn", danger: "bg-danger" }` and `tone = capacityTone(...)`. (Check `bg-warn`/`bg-danger` exist as tokens; the Carbon theme defines `--color-warn` and `--color-danger`, so Tailwind 4 derives them.)

`week-view.tsx`: under each day number render `<span className={`font-mono text-[11px] ${TONE_CLASS[capacityTone(d.capacity.plannedMinutes, d.capacity.freeMinutes)]}`}>{formatMinutes(d.capacity.plannedMinutes)} / {formatMinutes(d.capacity.freeMinutes)}</span>`; add one assertion to `week-view.test.tsx` that the line renders for a fixture day.

`prompt-bar.tsx`: where the task intent chip shows the due date, add the estimate when present: `~{formatMinutes(intent.estimateMinutes)}`; extend the prompt bar test that checks the chip for a task with a due date with a case for `"+ Write ~25m"` expecting the chip to contain `~25m`.

- [ ] **Step 8: Run everything**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "feat(planner): estimates on tasks, capacity line and bars, working hours chip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Morning ritual, `p` shortcut, palette Plan section, README

**Files:**
- Create: `src/components/planner/ritual-strip.tsx`, `src/components/planner/ritual-strip.test.tsx`
- Modify: `src/components/planner/plan-pane.tsx` (+ test), `src/components/tasks/task-row.tsx` (+ test), `src/components/shell/toasts.tsx` (+ test if one exists), `src/components/command-palette.tsx` (+ test), `README.md`

**Interfaces:**
- Consumes: `PlannerDayDTO.unfinishedYesterday`, `sources.due`, `POST /api/plan`, `POST /api/plan/carry-over`, `PATCH /api/plan`, `sb:planner-drawer`, `GET /api/tasks` (`{ tasks: TaskDTO[] }`, open by default), `TaskRow` `onPlan`/`onPlanDate`/`planFrom`/`planned`.
- Produces: `RitualStrip({ day, today, onDone })`; window event `sb:toast` (`CustomEvent<{ text: string }>`) handled by `ToastProvider`; `p` on a task row; palette "Plan" section.

- [ ] **Step 1: Failing ritual tests**

Create `src/components/planner/ritual-strip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import { RitualStrip, ritualDoneKey } from "./ritual-strip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

const TODAY = "2026-09-23";
let id = 1;
const task = (title: string, dueDate: string | null = null): TaskDTO => ({
  id: id++, title, notes: "", status: "open", priority: "normal", dueDate, containerId: null, sourceItemId: null, completedAt: null,
  sortOrder: 0, estimateMinutes: null, createdAt: "2026-09-22T09:00:00.000Z", updatedAt: "2026-09-22T09:00:00.000Z",
});
const late = task("Late", "2026-09-20");
const due = task("Due", TODAY);
const left = task("Left over");

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: TODAY, plan: [], unfinishedYesterday: [left], due: { overdue: [late], today: [due] }, meetings: [],
    calendar: { calendarsSeen: 1, permission: true },
    sources: { inbox: [], due: { overdue: [late], today: [due] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
    ...over,
  };
}
function stub() {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ moved: 1 });
  }));
  return posts;
}

describe("RitualStrip", () => {
  it("walks carry over, due, and projects, then reports done", async () => {
    const posts = stub();
    const onDone = vi.fn();
    render(<RitualStrip day={day()} today={TODAY} onDone={onDone} />);
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Carry over" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: "/api/plan/carry-over", body: { from: "2026-09-22", to: TODAY } }));
    await waitFor(() => expect(steps[1].getAttribute("aria-current")).toBe("step"));
    fireEvent.click(screen.getByRole("button", { name: "Plan all" }));
    await waitFor(() => expect(posts.slice(1).map((p) => p.body)).toEqual([
      { date: TODAY, taskId: late.id },
      { date: TODAY, taskId: due.id },
    ]));
    const drawerEvents: unknown[] = [];
    window.addEventListener("sb:planner-drawer", (e) => drawerEvents.push((e as CustomEvent).detail));
    fireEvent.click(screen.getByRole("button", { name: "Open projects" }));
    expect(drawerEvents).toEqual([{ tab: "projects", focus: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
    expect(localStorage.getItem(ritualDoneKey(TODAY))).toBe("1");
  });

  it("skips steps, and leaves out carry over when yesterday left nothing", () => {
    stub();
    render(<RitualStrip day={day({ unfinishedYesterday: [] })} today={TODAY} onDone={vi.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Carry over" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getAllByRole("listitem")[1].getAttribute("aria-current")).toBe("step");
  });
});
```

And in `plan-pane.test.tsx`:

```tsx
  it("opens today's empty plan with the ritual, and not another day's", () => {
    stubPlan();
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Plan the day" })).toBeTruthy();
    cleanup();
    render(<PlanPane day={day({ plan: [], date: "2026-09-24" })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull();
    expect(screen.getByText(/Nothing planned\. Add from the sources on the right, or press p on any task/)).toBeTruthy();
  });

  it("does not bring the ritual back once it was done today", async () => {
    stubPlan();
    localStorage.setItem("sb:ritual-done:" + TODAY, "1");
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull());
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/components/planner/ritual-strip.test.tsx src/components/planner/plan-pane.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the strip**

`src/components/planner/ritual-strip.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { addDaysLocal } from "../activity/format";
import { Button } from "../ui";
import { count } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };
export const ritualDoneKey = (date: string) => `sb:ritual-done:${date}`;

type StepId = "carry" | "due" | "projects";

/**
 * Three steps for an empty morning: carry over, plan what is due, pick from projects. The
 * strip is an ordered list; the current step carries aria-current, finished ones a check.
 */
export function RitualStrip({ day, today, onDone }: { day: PlannerDayDTO; today: string; onDone: () => void }) {
  const dueTasks = [...day.sources.due.overdue, ...day.sources.due.today];
  const steps: StepId[] = [...(day.unfinishedYesterday.length ? (["carry"] as StepId[]) : []), "due", "projects"];
  const [finished, setFinished] = useState<StepId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = steps.find((s) => !finished.includes(s));

  function finish(step: StepId) {
    const next = [...finished, step];
    setFinished(next);
    if (steps.every((s) => next.includes(s))) {
      try {
        localStorage.setItem(ritualDoneKey(day.date), "1");
      } catch {
        /* the strip just returns next time */
      }
      onDone();
    }
  }

  async function post(url: string, body: unknown): Promise<boolean> {
    const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (!res.ok) setError("Could not change the plan");
    return res.ok;
  }

  async function carryOver() {
    if (await post("/api/plan/carry-over", { from: addDaysLocal(day.date, -1), to: day.date })) {
      window.dispatchEvent(new Event("sb:plan-changed"));
      finish("carry");
    }
  }
  async function planAll() {
    for (const t of dueTasks) if (!(await post("/api/plan", { date: day.date, taskId: t.id }))) return;
    window.dispatchEvent(new Event("sb:plan-changed"));
    finish("due");
  }
  function openProjects() {
    window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects", focus: true } }));
  }

  const copy: Record<StepId, { title: string; detail: string; action: { label: string; run: () => void }; skipLabel: string }> = {
    carry: { title: "Carry over", detail: `${count(day.unfinishedYesterday.length, "unfinished task")} from yesterday`, action: { label: "Carry over", run: () => void carryOver() }, skipLabel: "Skip" },
    due: { title: "Review what is due", detail: `${day.sources.due.overdue.length} overdue, ${day.sources.due.today.length} due today`, action: { label: "Plan all", run: () => void planAll() }, skipLabel: "Skip" },
    projects: { title: "Pick from projects", detail: "Open the Projects tab and add what moves them forward", action: { label: "Open projects", run: openProjects }, skipLabel: "Done" },
  };

  return (
    <ol aria-label="Plan the day" className="flex flex-col m-0 p-0 list-none">
      {steps.map((step, i) => {
        const done = finished.includes(step);
        const active = step === current;
        const c = copy[step];
        return (
          <li key={step} aria-current={active ? "step" : undefined} className={`hairline-row flex items-center gap-3 py-2 ${active ? "text-fg" : "text-fg-faint"}`}>
            <span className="font-mono text-[11px] w-4 shrink-0">{done ? <Check className="w-3.5 h-3.5 text-violet" aria-hidden /> : i + 1}</span>
            <span className={`flex-1 min-w-0 text-[13px] ${done ? "line-through" : ""}`}>
              {c.title}
              <span className="text-fg-faint"> · {c.detail}</span>
            </span>
            {active && (
              <span className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="primary" onClick={c.action.run} disabled={step === "due" && dueTasks.length === 0}>
                  {c.action.label}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => finish(step)}>
                  {c.skipLabel}
                </Button>
              </span>
            )}
          </li>
        );
      })}
      {error && <li className="text-danger text-[12.5px] py-1">{error}</li>}
    </ol>
  );
}
```

`plan-pane.tsx`: replace the empty-state line with

```tsx
{day.plan.length === 0 ? (
  ritual ? <RitualStrip day={day} today={today} onDone={() => setRitual(false)} /> : <p className="text-[13px] text-fg-faint m-0">Nothing planned. Add from the sources on the right, or press p on any task.</p>
) : (
  <List aria-label="Plan" ...>
)}
```

where `ritual` starts as `day.date === today` and an effect reads `localStorage.getItem(ritualDoneKey(day.date))` (in try/catch) and, when set, `queueMicrotask(() => setRitual(false))`. The ritual step "Open projects" needs the drawer visible: the `sb:planner-drawer` event with a `tab` already opens the overlay on narrow screens (Task 2).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/planner`
Expected: PASS.

- [ ] **Step 5: Failing tests for the toast event and the `p` shortcut**

Append to `src/components/tasks/task-row.test.tsx`:

```tsx
describe("TaskRow keyboard planning", () => {
  it("plans on p from the title, unplans when already planned, and says so", () => {
    const onPlan = vi.fn();
    const toasts: unknown[] = [];
    window.addEventListener("sb:toast", (e) => toasts.push((e as CustomEvent).detail));
    mount({ task: task({ title: "Write" }), onPlan });
    const title = screen.getByRole("button", { name: "Write" });
    title.focus();
    fireEvent.keyDown(title, { key: "p" });
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([{ text: "Planned for today" }]);
    cleanup();
    mount({ task: task({ title: "Write" }), onPlan, planned: true });
    fireEvent.keyDown(screen.getByRole("button", { name: "Write" }), { key: "p" });
    expect(toasts[1]).toEqual({ text: "Taken off the plan" });
  });

  it("plans for the first offered day when the day is the caller's to choose", () => {
    const onPlanDate = vi.fn();
    mount({ task: task({ title: "Write" }), onPlanDate, planFrom: "2026-09-25" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Write" }), { key: "p" });
    expect(onPlanDate).toHaveBeenCalledWith("2026-09-25");
  });

  it("ignores p while the title is being edited", () => {
    const onPlan = vi.fn();
    mount({ task: task({ title: "Write" }), onPlan });
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "p" });
    expect(onPlan).not.toHaveBeenCalled();
  });
});
```

(Adjust the title's accessible name to how the row exposes it: the title button's name is the task title in the existing tests; check `TaskRow compact` tests for the pattern.)

For the toast provider, add to `src/components/shell/toasts.test.tsx` (create if absent, jsdom):

```tsx
it("shows a toast sent as a window event", async () => {
  render(<ToastProvider><span /></ToastProvider>);
  window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Planned for today" } }));
  expect(await screen.findByText("Planned for today")).toBeTruthy();
});
```

- [ ] **Step 6: Run to see them fail**

Run: `npx vitest run src/components/tasks src/components/shell/toasts.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement `p` and the toast event**

`toasts.tsx`: inside `ToastProvider`, add an effect:

```ts
useEffect(() => {
  function onToast(e: Event) {
    const text = (e as CustomEvent<{ text?: string }>).detail?.text;
    if (text) push({ text });
  }
  window.addEventListener("sb:toast", onToast);
  return () => window.removeEventListener("sb:toast", onToast);
}, [push]);
```

(`push` must be stable: wrap it in `useCallback` if it is not already.)

`task-row.tsx`: add a helper and a keydown on the row's `<li>`:

```ts
/** Plans from the keyboard: today's plan, or the first day the row was told to offer. */
function planFromKey() {
  if (onPlan) {
    onPlan();
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: planned ? "Taken off the plan" : planLabel === "Plan for today" ? "Planned for today" : "Planned" } }));
  } else if (onPlanDate) {
    onPlanDate(planFrom);
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: planFrom === today ? "Planned for today" : `Planned for ${planFrom}` } }));
  }
}
```

On the `<li>`: `onKeyDown={(e) => { if (e.key === "p" && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && (onPlan || onPlanDate)) { e.preventDefault(); planFromKey(); } }}`. The menu's own "Plan for today" item keeps working unchanged.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/components/tasks src/components/shell`
Expected: PASS.

- [ ] **Step 9: Failing palette test**

Append to `src/components/command-palette.test.tsx` (follow its existing open-and-type pattern and fetch stub; the stub must answer `/api/tasks` with `{ tasks: [...] }` and `/api/plan` with `{}`):

```tsx
  it("offers to plan a matching open task once two characters are typed", async () => {
    const posts = stubWith({ tasks: [{ id: 5, title: "Write the release note", status: "open" }] });
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "w" } });
    expect(screen.queryByText("Plan")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wr" } });
    const item = await screen.findByText("Write the release note");
    expect(screen.getByText("Plan")).toBeTruthy();
    fireEvent.click(item);
    await waitFor(() => expect(posts.find((p) => p.url === "/api/plan")?.body).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), taskId: 5 }));
  });
```

- [ ] **Step 10: Run to see it fail**

Run: `npx vitest run src/components/command-palette.test.tsx`
Expected: FAIL.

- [ ] **Step 11: Implement the Plan section**

`command-palette.tsx`: alongside the containers load, fetch `/api/tasks` (`{ tasks: TaskDTO[] }`) when the palette opens into `tasks` state. Build

```ts
const plans = useMemo<Command[]>(() => {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return tasks
    .filter((t) => t.title.toLowerCase().includes(q))
    .slice(0, 6)
    .map((t) => ({
      id: `plan:${t.id}`,
      label: t.title,
      prefix: "Plan",
      iconName: "planner" as IconName,
      run: () => {
        void fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: todayLocal(), taskId: t.id }) }).then((res) => {
          if (!res.ok) return;
          window.dispatchEvent(new Event("sb:plan-changed"));
          window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Planned for today" } }));
        });
      },
    }));
}, [tasks, query]);
```

(`todayLocal` from `../activity/format`.) `filtered` becomes `[...filteredViews, ...filteredJumps, ...plans]`; render a `<li className="micro px-4 pt-3 pb-1">Plan</li>` heading before the plan rows, indexed after the jumps.

- [ ] **Step 12: Run everything, then README**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: green.

README: in the `## Planner` section, add a paragraph "Planning the day" covering the drawer (tabs, add, drag, `⌘/`), estimates (`~25m` in the prompt bar, the chip), the capacity line and working hours, the morning ritual, `p`, and the palette's Plan section.

- [ ] **Step 13: Commit**

```bash
git add -A src README.md
git commit -m "feat(planner): morning ritual, plan from the keyboard and the palette

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: §2 layout → Task 2 day view; §3 drawer (tabs, groups, search, add, dim/unplan, counts, empty lines, remembered tab, drag both ways, `plannerSources`) → Tasks 1–2; §4 estimates (chip, presets, bounds, `~` suffix, intent chip), capacity (merge, hours setting, header line with tones and title, plan bar, week line, `capacity.ts`) → Tasks 1 and 3; §5 ritual (three steps, skip, collapse, `localStorage`, reworded empty state) → Task 4; §6 `p`, palette Plan, `⌘/`, Enter in the drawer → Tasks 2 and 4; §7 tokens; §8 migration, DTOs, settings route; §9 tablist, labels, `role="status"`, `aria-current`; §10 tests per task; §11 order matches. Motion (§7 slide-in and bar width) is the list's existing layout animation plus the bar's `transition-[width]`; the ritual's height spring is left to the reviewer's discretion (not load-bearing).
- Placeholders: none.
- Type consistency: `estimateMinutes` (DTO, body, domain, quickParse, intent); `CapacityDTO` fields `freeMinutes/plannedMinutes/unestimated/workHours` used the same way in Tasks 1 and 3; `PlannerSourcesDTO` shape shared by Tasks 1, 2, 4; `sb:planner-drawer` detail `{ tab, focus, toggle }` in Tasks 2 and 4; `TASK_DRAG_MIME` and `application/x-sb-plan` in Task 2 only; `sb:toast` detail `{ text }` in Task 4.
