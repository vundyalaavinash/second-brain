# Weekly Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided twenty-minute pass at the end of the week that assembles itself — what the week did, which goals moved, what next week already holds — and writes one readable record of it.

**Architecture:** No new table. A review is an `items` row of type `review`, keyed by the unique `review_week` column that has been in the schema since the beginning: one per ISO week, named by its Monday. `src/lib/review.ts` assembles the week's figures from the domains that already own them — plan, tasks, goals, focus, meetings — and the four free-text answers live in the item's body and meta, saved as each step is left. `/review` is four panes, one per step, with its own progress across the top.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint: no synchronous `setState` in effect bodies), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3, zod 4, Vitest 5 jsdom, `motion` 12.

**Spec:** `docs/superpowers/specs/2026-09-24-closing-the-loop-design.md` (§5, §7)

**Depends on:** the goals slice (`src/domain/goals`) and the focus slice (`src/domain/focus`), both merged before this plan starts.

## Global Constraints

- Carbon tokens only — `src/test/tokens.test.ts` fails on `ink`, `slate`, `brass`, `paper`, `tone=`, `on-paper`, `shadow-dock`. Sentence case. `focus-ring` on every interactive element. `aria-label` on icon-only controls.
- No synchronous `setState` in an effect body (react-compiler lint).
- Tests never touch the network, and never depend on today's real date: every function that needs the week takes it as an argument.
- A week is named by its **Monday**, as `YYYY-MM-DD`. The week runs Monday through Sunday inclusive.
- Exactly one review item per week, enforced by the existing unique index on `items.review_week`. Creating a second for the same week must return the first, not throw and not duplicate.
- The four steps are exactly `clear`, `back`, `goals`, `ahead`, in that order. `REVIEW_STEPS` is an exported constant array.
- The review's answers are stored in the item's `meta` under `answers`, keyed by step; the item's `body` is the rendered Markdown of those answers, rewritten on every save, so the Library reads it as a normal note.
- The Home prompt appears from **Friday** onward (`PROMPT_FROM_WEEKDAY = 5`, Monday being 1) and only when the current week has no review item. It never escalates.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/week.ts` (+ test) | `weekStart`, `weekDays`, `weekLabel` — one place that knows what a week is |
| `src/domain/review/index.ts` (+ test) | get-or-create the week's item, save a step, the snapshot |
| `src/lib/review.ts` (+ test) | `reviewPayload(db, week, now)` — the whole assembled week |
| `src/lib/dto.ts`, `src/lib/validation.ts` | `ReviewDTO`, `ReviewAnswersDTO`, `SaveReviewBody`, `ReviewPlanBody` |
| `src/app/api/review/route.ts`, `src/app/api/review/plan/route.ts`, `src/app/api/review.test.ts` | the endpoints |
| `src/app/review/page.tsx` | the route |
| `src/components/review/review-page.tsx`, `step-clear.tsx`, `step-back.tsx`, `step-goals.tsx`, `step-ahead.tsx`, `step-nav.tsx` (+ tests) | the four panes |
| `src/lib/home.ts`, `src/components/home/top-band.tsx` | the quiet Friday line |
| `src/components/nav.ts`, `src/components/icons.tsx` | the dock entry |
| `README.md` | one section |

---

### Task 1: The week, the record and the assembled payload

**Files:**
- Create: `src/lib/week.ts`, `src/lib/week.test.ts`, `src/domain/review/index.ts`, `src/domain/review/index.test.ts`, `src/lib/review.ts`, `src/lib/review.test.ts`
- Modify: `src/lib/dto.ts`, `src/lib/validation.ts`

**Interfaces:**
- Consumes: `createItem`, `getItem`, `updateItem`, `mergeItemMeta`, `parseMeta`, `countInbox` from `@/domain/items`; `listPlan`, `unfinished` from `@/domain/plan`; `listTasks` from `@/domain/tasks`; `goalsWithMeasure` from `@/domain/goals`; `focusSummary` from `@/domain/focus`; `listBlocks` from `@/domain/blocks`; the meetings domain for the week's calendar rows; `containerProgress` from `@/domain/tasks`.
- Produces:
  - `src/lib/week.ts`: `weekStart(day: string): string` (the Monday of that day's week), `weekDays(start: string): string[]` (seven days), `weekLabel(start: string): string` ("Week of 22 September"), `weekEnd(start: string): string` (the Sunday), `nextWeek(start: string): string`.
  - `src/domain/review/index.ts`: `REVIEW_STEPS = ["clear", "back", "goals", "ahead"] as const`; `type ReviewStep`; `type ReviewAnswers = { clear?: string; back?: string; goals?: Record<string, string>; ahead?: string }`; `getReview(db, week): Item | undefined`; `openReview(db, week): Item` (get-or-create, idempotent); `saveReviewStep(db, week, step, value, snapshot?): Item`; `reviewAnswers(item): ReviewAnswers`; `renderReviewBody(week, answers, snapshot): string`.
  - `src/lib/review.ts`: `reviewPayload(db, week: string, now: Date): ReviewDTO`.
  - `src/lib/dto.ts`: `ReviewDTO` (see Step 5).

- [ ] **Step 1: Write the failing week test**

Create `src/lib/week.test.ts`. The Monday rule is the one thing everything else trusts, so pin every edge:

```ts
import { describe, it, expect } from "vitest";
import { weekStart, weekEnd, weekDays, nextWeek, weekLabel } from "./week";

describe("weekStart", () => {
  it("returns the day itself for a Monday", () => {
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
  });
  it("walks back to Monday from mid-week", () => {
    expect(weekStart("2026-09-24")).toBe("2026-09-21");
  });
  it("treats Sunday as the end of the week it closes, not the start of the next", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
  });
  it("crosses a month and a year boundary", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("the rest of the week", () => {
  it("ends on Sunday and holds seven days", () => {
    expect(weekEnd("2026-09-21")).toBe("2026-09-27");
    expect(weekDays("2026-09-21")).toHaveLength(7);
    expect(weekDays("2026-09-21")[6]).toBe("2026-09-27");
  });
  it("names the next week and labels its own", () => {
    expect(nextWeek("2026-09-21")).toBe("2026-09-28");
    expect(weekLabel("2026-09-21")).toMatch(/21 September/);
  });
});
```

Build these on top of `addDaysLocal` from `@/components/activity/format` rather than raw `Date` arithmetic — that helper already handles the local-day spelling the rest of the app uses. First check whether a week-start helper already exists (look at `src/app/planner/week/page.tsx`); if it does, move it into `src/lib/week.ts` and have the page import it, rather than writing a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/week.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/lib/week.ts`, run the test**

Expected: PASS.

- [ ] **Step 4: Write the failing review-domain test**

`src/domain/review/index.test.ts`:

```ts
it("opens the same item twice for the same week", () => {
  const a = openReview(db, "2026-09-21");
  const b = openReview(db, "2026-09-21");
  expect(b.id).toBe(a.id);
  expect(listItems(db, { type: "review" })).toHaveLength(1);
});

it("keeps each step's answer and leaves the others alone", () => {
  openReview(db, "2026-09-21");
  saveReviewStep(db, "2026-09-21", "back", "Shipped the API.");
  saveReviewStep(db, "2026-09-21", "ahead", "Start the docs.");
  expect(reviewAnswers(getReview(db, "2026-09-21")!)).toMatchObject({ back: "Shipped the API.", ahead: "Start the docs." });
});

it("keeps a note per goal under the goals step", () => {
  openReview(db, "2026-09-21");
  saveReviewStep(db, "2026-09-21", "goals", { "7": "Slipped a week." });
  expect(reviewAnswers(getReview(db, "2026-09-21")!).goals).toEqual({ "7": "Slipped a week." });
});

it("rewrites the body as readable Markdown on every save", () => {
  openReview(db, "2026-09-21");
  saveReviewStep(db, "2026-09-21", "back", "Shipped the API.");
  expect(getReview(db, "2026-09-21")!.body).toContain("Shipped the API.");
});

it("resumes a half-finished review at the step after the last one answered", () => {
  openReview(db, "2026-09-21");
  saveReviewStep(db, "2026-09-21", "clear", "done");
  expect(nextStep(reviewAnswers(getReview(db, "2026-09-21")!))).toBe("back");
});
```

`nextStep(answers): ReviewStep` is part of the module's surface — the first step in `REVIEW_STEPS` with no answer, or the last step when all are answered.

- [ ] **Step 5: Run to verify it fails, then write the module**

The item is created with `type: "review"`, `reviewWeek: week`, a title of `weekLabel(week)`, and `status` set to whatever the item domain uses for a note that needs no processing — read `createItem` and match how a journal item is made, since `journal_date` is the exact same pattern one column over.

`openReview` must be idempotent under the unique index: select first, insert second, and catch the unique-constraint failure by re-selecting, so two tabs opening the review at once end up on one item rather than one of them erroring.

Run: `npx vitest run src/domain/review/index.test.ts` — expected PASS.

- [ ] **Step 6: The assembled payload**

`src/lib/review.ts` builds `ReviewDTO`:

```ts
export interface ReviewDTO {
  week: string;                       // the Monday
  label: string;                      // "Week of 21 September"
  days: string[];
  /** Whether the week being reviewed is the one the app is being used in. */
  current: boolean;
  step: ReviewStep;                   // where to resume
  answers: ReviewAnswersDTO;
  clear: {
    inbox: number;
    leftover: PlanTaskDTO[];          // still open on any day of the week
  };
  back: {
    done: number;
    dropped: number;
    slipped: number;                  // planned in the week and still open
    focusMinutes: number;
    focusRuns: number;
    meetings: number;
    projects: { container: ContainerRefDTO; closed: number; percent: number }[];
  };
  goals: GoalDTO[];                   // active goals, each with its measure for this week
  ahead: {
    week: string;                     // next Monday
    due: TaskDTO[];
    deadlines: { container: ContainerRefDTO; deadline: string }[];
    meetings: ActivityMeetingDTO[];
  };
  savedAt: string | null;
}
```

Every figure comes from the domain that already owns it. Do not re-derive "done this week" with a new query if `listTasks` can be filtered; do not count meetings differently from the way `homePayload` counts them — non-declined and not all-day — or Home and the review will disagree about the same week, which is exactly the bug the Home slice was fixed for.

Its test seeds a week, asserts each figure, and asserts that a task planned on Tuesday and still open counts once as `slipped` and once in `clear.leftover`, not twice in either.

- [ ] **Step 7: Validation and DTO exports**

```ts
export const SaveReviewBody = z
  .object({
    week: DateString,
    step: z.enum(REVIEW_STEPS),
    value: z.union([z.string(), z.record(z.string(), z.string())]),
  })
  .strict();

export const ReviewPlanBody = z.object({ week: DateString, taskIds: z.array(z.number().int().positive()) }).strict();
```

- [ ] **Step 8: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add -A
git commit -m "feat(review): the week, the record it writes, and the figures it assembles

<trailers>"
```

---

### Task 2: The four panes

**Files:**
- Create: `src/app/review/page.tsx`, `src/components/review/review-page.tsx`, `step-nav.tsx`, `step-clear.tsx`, `step-back.tsx`, `step-goals.tsx`, `step-ahead.tsx`, and tests for `review-page` and `step-goals`
- Create: `src/app/api/review/route.ts`, `src/app/api/review/plan/route.ts`, `src/app/api/review.test.ts`
- Modify: `src/components/nav.ts`, `src/components/icons.tsx`, `src/components/nav.test.ts`

**Interfaces:**
- Consumes: `ReviewDTO`, the `/api/review` endpoints, `InboxProcessor` from `@/components/inbox-processor`, `PlanPane` from `@/components/planner/plan-pane`, `GoalRow` from `@/components/goals/goal-row`.
- Produces: the `/review` route and `GET/PATCH /api/review`, `POST /api/review/plan`.

- [ ] **Step 1: The routes**

`GET /api/review?week=YYYY-MM-DD` (defaulting to the current week) answers `reviewPayload`. `PATCH /api/review` takes `SaveReviewBody`, saves the step and answers the refreshed payload. `POST /api/review/plan` takes `ReviewPlanBody` and adds each task to the first day of the named week through `addToPlan`, answering `{ planned: number }`. `PATCH` and `POST` gate on `crossSite`.

Its test: save a step, read it back, plan two tasks into next week and assert they are on that Monday's plan.

- [ ] **Step 2: Write the failing page test**

`src/components/review/review-page.test.tsx`, jsdom:

```tsx
it("opens on the step the saved review left off at", () => { /* answers with clear filled → the Look back pane is showing */ });
it("moves forward and back without losing what was typed", () => { /* type, Next, Back, the text is still there */ });
it("names every step in the nav, and marks the answered ones", () => { /* four labels, one marked done */ });
it("says so when the week has nothing to show rather than rendering empty panes", () => { /* a seeded-empty week reads as a sentence, not blank boxes */ });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/review/review-page.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Build the panes**

`ReviewPage` holds the payload, the current step and the draft text, and saves on leaving a step — not on every keystroke. A save in flight must not lose a keystroke typed while it runs: keep the draft in state and the request keyed by step.

- **Clear** reuses `InboxProcessor` for the inbox rather than building a second one, and lists the week's leftover tasks with carry / drop / leave per row. "Carry" moves the task to the next week's Monday; "drop" calls the existing drop.
- **Look back** renders the figures as a small table, not a paragraph of numbers, plus the free-text box. Empty is a sentence: "Nothing was planned this week."
- **Goals** lists each active goal with `GoalRow` and a one-line box beneath it. A stalled goal says so here, once, in `text-fg-faint`.
- **Look ahead** lists next week's due tasks and deadlines with checkboxes, the meetings already on the calendar, the intention box, and one "Plan these" button calling `/api/review/plan`.

`StepNav` is the four labels across the top, each a button, the current one marked with `aria-current="step"` and the answered ones with a tick. It is a `<nav aria-label="Review steps">`.

- [ ] **Step 5: Run the page test**

Run: `npx vitest run src/components/review/review-page.test.tsx`
Expected: PASS.

- [ ] **Step 6: The dock entry**

`{ href: "/review", label: "Review", shortcut: "g w", icon: "review", section: "brain" }`, after Goals. Add `"review"` to `IconName` and draw the icon — a loop, closing — matching its neighbours' stroke and viewBox. Check `g w` is free in `src/components/shortcuts.tsx` first. Update `src/components/nav.test.ts`.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add -A
git commit -m "feat(review): four panes that assemble the week and write it down

<trailers>"
```

---

### Task 3: The prompt, the record, and the README

**Files:**
- Modify: `src/lib/home.ts` (+ test), `src/components/home/top-band.tsx` (+ test), `src/lib/dto.ts`, `README.md`

**Interfaces:**
- Produces: `HomeDTO.review: { week: string; due: boolean; savedAt: string | null }`.

- [ ] **Step 1: Write the failing test**

In `src/lib/home.test.ts`:

```ts
it("does not ask for a review before Friday", () => { /* a Wednesday → due false */ });
it("asks from Friday when the week has no review", () => { /* a Friday → due true */ });
it("stops asking once the week has one", () => { /* same Friday, review item present → due false */ });
```

`homePayload` already takes `now`, so every case pins its own day. Do not read the real date.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/home.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add it**

`homePayload` gains `review`, computed from `weekStart(date)`, the weekday, and `getReview`. `TopBand` renders one quiet line when `due` — "Review your week", linking to `/review`, in `text-fg-muted`, with no badge, no colour and no count. When a review exists it renders nothing at all, not a tick.

- [ ] **Step 4: The record reads back**

Confirm by test that a saved review appears in `listItems(db, { type: "review" })` and that its body is the Markdown of the answers, so the Library and the semantic search both find it with no further work. If the Library filters its type list explicitly, add `review` to it.

- [ ] **Step 5: README**

A Weekly review section: the four steps, that it writes one item per week readable in the Library, that it resumes where it stopped, and the `g w` shortcut. Then a short closing paragraph tying goals, focus and the review together as one loop — direction, execution, reflection — because that is what the three slices are for.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add -A
git commit -m "feat(review): Home asks once, from Friday, and never again that week

<trailers>"
```
