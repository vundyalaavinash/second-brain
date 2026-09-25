# The Honest Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The planner stops reporting arithmetic and starts reporting a forecast — one that knows what time it is, which days you work, and how long your work has actually taken you before.

**Architecture:** A new pure module `src/lib/drift.ts` turns finished tasks and their focus runs into one number: the median of actual over estimate. `src/lib/capacity.ts` gains a `now` so the free figure shrinks as the day goes, and working days move into planner settings so a weekend is not nine hours. The capacity line and the week view then say three things instead of two, and the middle one — "about 7h 20m at your pace" — is the whole feature.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint: no synchronous `setState` in effect bodies), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3, zod 4, Vitest 5 jsdom, `motion` 12.

**Spec:** `docs/superpowers/specs/2026-09-25-reliable-planner-design.md` (§4)

## Global Constraints

- Carbon tokens only — `src/test/tokens.test.ts` bans `ink`, `slate`, `brass`, `paper`, `tone=`, `on-paper`, `shadow-dock`. Sentence case. `focus-ring` on every interactive element. `aria-label` on icon-only controls.
- No synchronous `setState` in an effect body (react-compiler lint).
- Tests never touch the network, never depend on the real clock, and **never depend on the machine's timezone**. Build date fixtures from local components, not UTC strings. Two files already fail under `TZ=Pacific/Midway` (`src/domain/activity/calendar.test.ts`, `src/lib/planner.test.ts`) and are a recorded pre-existing follow-up; do not add a third.
- Every function needing the clock takes `now: Date` as an argument with a default.
- **Drift constants:** window 30 tasks, minimum 8 pairs, clamp 0.5–4.0. All exported, none written as a literal at a use site.
- **With fewer than the minimum pairs there is no drift figure at all.** Not 1.0, not a guess — `null`, and the interface says why. This is the point of the feature; a made-up multiplier is the failure mode it exists to prevent.
- Working days default to Monday–Friday and are stored under `planner.workingDays`.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/drift.ts` (+ test) | `driftFactor`, `forecastMinutes`, the constants |
| `src/domain/focus/index.ts` | `estimateActualPairs(db, limit)` — the raw material |
| `src/lib/capacity.ts` (+ test) | `freeMinutes` takes `now`; `forecast` helper |
| `src/lib/work-hours.ts` (+ test) | working days beside working hours |
| `src/lib/planner.ts` | day and week payloads carry the forecast |
| `src/lib/dto.ts` | `CapacityDTO.forecastMinutes`, `.drift`, `.leftTodayMinutes`; `PlannerWeekDTO` day `working` |
| `src/app/api/settings/planner/route.ts` | working days, and the missing origin guard |
| `src/components/planner/capacity-line.tsx` (+ test) | the three figures and the sentence |
| `src/components/planner/week-view.tsx` (+ test) | a non-working day reads as a gap |
| `src/components/tasks/estimate-hint.tsx` (+ test) | "tasks like this have taken about 50m" |
| `README.md` | one section |

---

### Task 1: Drift, a capacity that knows the time, and working days

**Files:**
- Create: `src/lib/drift.ts`, `src/lib/drift.test.ts`
- Modify: `src/domain/focus/index.ts` (+ test), `src/lib/capacity.ts` (+ test), `src/lib/work-hours.ts` (+ test), `src/lib/dto.ts`, `src/lib/planner.ts` (+ test), `src/app/api/settings/planner/route.ts` (+ a test file if none exists)

**Interfaces:**
- Consumes: `focusMinutesByTask` and the `focusRuns` table from `@/domain/focus`; `getSetting`/`setSetting` from `@/domain/settings`; `crossSite`, `forbidden`, `errorResponse` from `@/lib/api`.
- Produces:
  - `src/lib/drift.ts`:
    - `export const DRIFT_WINDOW = 30;` `export const DRIFT_MIN_PAIRS = 8;` `export const DRIFT_FLOOR = 0.5;` `export const DRIFT_CEILING = 4.0;`
    - `export interface Pair { estimateMinutes: number; actualMinutes: number }`
    - `driftFactor(pairs: Pair[]): number | null` — the median of `actual / estimate` over at most `DRIFT_WINDOW` pairs, clamped, or `null` below `DRIFT_MIN_PAIRS`.
    - `forecastMinutes(planned: number, drift: number | null): number | null` — `planned × drift`, rounded to the minute; `null` when drift is null.
  - `src/domain/focus/index.ts`: `estimateActualPairs(db: DB, limit = DRIFT_WINDOW): Pair[]` — for tasks that are `done`, have a non-null `estimateMinutes`, and have at least one run that booked minutes, the estimate against the **sum** of that task's booked minutes, newest completion first, in one grouped query.
  - `src/lib/capacity.ts`: `freeMinutes(meetings, workHours, date, opts?: { now?: Date })`. On a date earlier than `now`'s day the answer is 0; on `now`'s own day the window starts at the later of the hours' start and the current minute; on a later date it is the whole window. Existing callers that pass no `opts` keep today's behaviour of the whole window, so nothing silently changes under them.
  - `src/lib/work-hours.ts`: `WORKING_DAYS_KEY = "planner.workingDays"`, `DEFAULT_WORKING_DAYS = "1,2,3,4,5"` (ISO weekdays, Monday 1), `getWorkingDays(db): number[]`, `setWorkingDays(db, days: number[]): number[]`, `isWorkingDay(days: number[], date: string): boolean`.
  - `src/lib/dto.ts`: `CapacityDTO` gains `drift: number | null`, `forecastMinutes: number | null`, `leftTodayMinutes: number`; `PlannerWeekDTO`'s day gains `working: boolean`.
  - Route: `GET/PATCH /api/settings/planner` handles `workingDays` alongside `workHours`, and `PATCH` gates on `crossSite`.

- [ ] **Step 1: Write the failing drift test**

Create `src/lib/drift.test.ts`. The `null` cases matter more than the arithmetic — they are the honesty of the feature:

```ts
import { describe, it, expect } from "vitest";
import { driftFactor, forecastMinutes, DRIFT_MIN_PAIRS, DRIFT_WINDOW, DRIFT_FLOOR, DRIFT_CEILING } from "./drift";

const pairs = (ratios: number[]) => ratios.map((r) => ({ estimateMinutes: 60, actualMinutes: 60 * r }));

describe("driftFactor", () => {
  it("has no answer below the minimum, rather than a made-up one", () => {
    expect(driftFactor(pairs(Array(DRIFT_MIN_PAIRS - 1).fill(2)))).toBeNull();
    expect(driftFactor([])).toBeNull();
  });

  it("answers at exactly the minimum", () => {
    expect(driftFactor(pairs(Array(DRIFT_MIN_PAIRS).fill(2)))).toBe(2);
  });

  it("takes the median, so one runaway task does not move it", () => {
    // Eight tasks that ran roughly on time and one that ran six times over.
    const ratios = [1, 1, 1.1, 1.2, 1, 1.1, 1, 1.2, 6];
    expect(driftFactor(pairs(ratios))).toBeCloseTo(1.1, 5);
  });

  it("reads only the most recent window", () => {
    // Older entries come last: the newest DRIFT_WINDOW are all 2, the tail is all 1.
    const recent = pairs(Array(DRIFT_WINDOW).fill(2));
    const old = pairs(Array(20).fill(1));
    expect(driftFactor([...recent, ...old])).toBe(2);
  });

  it("clamps a figure that is a bug in the data rather than a fact about the person", () => {
    expect(driftFactor(pairs(Array(10).fill(99)))).toBe(DRIFT_CEILING);
    expect(driftFactor(pairs(Array(10).fill(0.01)))).toBe(DRIFT_FLOOR);
  });

  it("ignores a pair with a zero or absent estimate rather than dividing by it", () => {
    const withZero = [...pairs(Array(DRIFT_MIN_PAIRS).fill(2)), { estimateMinutes: 0, actualMinutes: 30 }];
    expect(driftFactor(withZero)).toBe(2);
  });
});

describe("forecastMinutes", () => {
  it("is null without a drift figure, so nothing downstream invents one", () => {
    expect(forecastMinutes(120, null)).toBeNull();
  });
  it("multiplies and rounds to the minute", () => {
    expect(forecastMinutes(120, 1.5)).toBe(180);
    expect(forecastMinutes(50, 1.33)).toBe(67);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/drift.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `src/lib/drift.ts`**

```ts
/** How many finished tasks the figure looks back over. Enough to be stable, recent enough to
 * follow a person as they change. */
export const DRIFT_WINDOW = 30;
/** Below this many pairs there is no figure at all. A multiplier built from three data points
 * is exactly the false confidence this feature exists to remove (spec §4.1). */
export const DRIFT_MIN_PAIRS = 8;
/** Outside this range the number is a bug in the data, not a fact about the person. */
export const DRIFT_FLOOR = 0.5;
export const DRIFT_CEILING = 4.0;

export interface Pair {
  estimateMinutes: number;
  actualMinutes: number;
}

/**
 * How long this person's work actually takes against what they guessed, as one multiplier.
 * The median rather than the mean: one task that ran six times over says something about that
 * task, not about the next estimate.
 */
export function driftFactor(pairs: Pair[]): number | null {
  const ratios = pairs
    .slice(0, DRIFT_WINDOW)
    .filter((p) => p.estimateMinutes > 0 && p.actualMinutes >= 0)
    .map((p) => p.actualMinutes / p.estimateMinutes)
    .sort((a, b) => a - b);
  if (ratios.length < DRIFT_MIN_PAIRS) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(DRIFT_CEILING, Math.max(DRIFT_FLOOR, median));
}

/** What a plan of `planned` estimated minutes is likely to actually cost. */
export function forecastMinutes(planned: number, drift: number | null): number | null {
  return drift === null ? null : Math.round(planned * drift);
}
```

- [ ] **Step 4: Run the drift test**

Run: `npx vitest run src/lib/drift.test.ts`
Expected: PASS.

- [ ] **Step 5: `estimateActualPairs` in the focus domain**

Add to `src/domain/focus/index.ts`, with a test in its existing test file. One grouped query, never one per task:

- Join `tasks` to `focus_runs`.
- Keep tasks where `status = 'done'`, `estimate_minutes` is not null and greater than zero, and the run's `actual_minutes` is not null and greater than zero.
- Group by task, summing `actual_minutes`.
- Order by the task's `completed_at` descending, take `limit`.

Test it against a seeded database: a task with two runs contributes one pair whose actual is the sum; a task with no estimate contributes nothing; a task still open contributes nothing; an abandoned run contributes nothing; and the order really is newest-completion-first.

- [ ] **Step 6: `freeMinutes` learns what time it is**

Change the signature to `freeMinutes(meetings, workHours, date, opts: { now?: Date } = {})`. Before subtracting meetings, move the window's start:

```ts
const today = localDay(opts.now?.toISOString() ?? "");
// A day already gone holds nothing, and the part of today that has passed is not free time.
// The scheduler has always known this (`notBefore`); the figure people read never did.
let start = hours.start;
if (opts.now) {
  if (date < today) return 0;
  if (date === today) start = Math.max(start, minutesOfDay(opts.now));
  if (start >= hours.end) return 0;
}
```

Add tests: a past day is zero; midway through today is the remainder; after the working day ends is zero; a future day is the whole window; and with no `now` passed the behaviour is exactly what it was, so no existing caller changes underneath.

- [ ] **Step 7: Working days**

In `src/lib/work-hours.ts`, beside the hours. Store as a comma-separated list of ISO weekday numbers so the setting stays a plain string like every other one. `setWorkingDays` rejects an empty list and anything outside 1–7, through `TaskError(…, 400)` as `setWorkHours` does. `isWorkingDay` builds the weekday from local date components — **not** from `new Date(date).getDay()` on a bare `YYYY-MM-DD`, which is parsed as UTC and is a day out west of Greenwich.

- [ ] **Step 8: Payloads and the route**

`plannerDay` and `plannerWeek` compute drift once per request (one `estimateActualPairs` call, not one per day) and fill `CapacityDTO.drift`, `.forecastMinutes` and `.leftTodayMinutes`. A week's day gains `working`, and a non-working day reports zero capacity.

The settings route accepts `workingDays: number[]` alongside `workHours`, answers both, and **gains the `crossSite` guard its PATCH is missing** — the focus slice's review noted it as a pre-existing gap and this is the task that touches the file.

- [ ] **Step 9: Run the suite**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus `TZ=Pacific/Midway npm test` where the only failures are the two known pre-existing files.
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(planner): drift, a free figure that knows the time, and days you actually work

<trailers>"
```

---

### Task 2: What the planner says

**Files:**
- Modify: `src/components/planner/capacity-line.tsx` (+ test), `src/components/planner/week-view.tsx` (+ test), `src/components/planner/date-header.tsx` if the week's summary needs it, `src/components/home/top-band.tsx` if it shows a capacity figure

**Interfaces:**
- Consumes: `CapacityDTO`'s three new fields; `formatMinutes` from `@/lib/capacity`.
- Produces: no new exports — this task is what the person sees.

- [ ] **Step 1: Write the failing capacity-line test**

```tsx
// @vitest-environment jsdom
it("leads with the plan, then what it will really cost, then what is left", () => {
  render(<CapacityLine capacity={cap({ plannedMinutes: 270, forecastMinutes: 440, leftTodayMinutes: 310, drift: 1.63 })} … />);
  expect(screen.getByText(/4h 30m planned/)).toBeTruthy();
  expect(screen.getByText(/about 7h 20m at your pace/i)).toBeTruthy();
  expect(screen.getByText(/5h 10m left/i)).toBeTruthy();
});

it("says plainly when the day will not hold it", () => {
  render(<CapacityLine capacity={cap({ plannedMinutes: 270, forecastMinutes: 440, leftTodayMinutes: 310 })} … />);
  expect(screen.getByText(/about 2h more than today holds/i)).toBeTruthy();
});

it("drops the middle figure and says why when there is no history yet", () => {
  render(<CapacityLine capacity={cap({ drift: null, forecastMinutes: null })} … />);
  expect(screen.queryByText(/at your pace/i)).toBeNull();
  expect(screen.getByText(/not enough finished work yet/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails, then build it**

The three figures on one line, middle-dotted the way the line already reads. The over-capacity sentence replaces the tone colour rather than joining it — read `capacityTone` and decide whether it still earns its place now that there is a sentence. If it does not, remove it and say so in the report.

The "not enough finished work yet" line is `text-fg-faint`, appears once, and does not repeat on the week.

- [ ] **Step 3: The week stops offering nine hours on a Saturday**

A day with `working: false` renders as a quiet gap: the date, and nothing about capacity. The week's summary counts only working days. Test both.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git commit -m "feat(planner): the capacity line forecasts instead of counting

<trailers>"
```

---

### Task 3: Estimates that learn from what actually happened

**Files:**
- Create: `src/components/tasks/estimate-hint.tsx` (+ test)
- Modify: `src/domain/focus/index.ts` (+ test) for the lookup, `src/lib/api.ts` and `src/lib/dto.ts` to carry it, `src/components/tasks/task-row.tsx`

**Interfaces:**
- Produces: `similarActualMinutes(db, task, limit)` in the focus domain — the median actual of finished tasks in the same container whose titles share a meaningful word with this one, or `null` when there are fewer than three; `TaskDTO.likeThisMinutes: number | null`.

- [ ] **Step 1: The lookup**

Matching is deliberately dull: same container, both titles share at least one word of four or more letters after lowercasing, and the task is done with booked minutes. Three matches minimum. Anything cleverer is a guess dressed as an insight, and a wrong hint is worse than none.

Batch it the way `focusMinutesByTask` and `goalRefsByContainer` already are — **one query for a list of tasks, never one per row.** Two reviews on this repository have turned on exactly that point.

- [ ] **Step 2: The hint**

`EstimateHint` renders only on an open task with no estimate and a non-null `likeThisMinutes`: "Tasks like this have taken about 50m", with a button that sets it. Nothing renders otherwise — no placeholder, no zero. Test the absent case.

- [ ] **Step 3: README**

A Planner section covering drift, what the three figures mean, working days, and that a forecast appears only once there is enough finished work to build one from. Match the voice of the Goals and Focus sections.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus the `TZ` run.

```bash
git commit -m "feat(planner): an unestimated task is offered what work like it actually cost

<trailers>"
```
