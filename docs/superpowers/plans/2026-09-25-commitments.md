# Commitments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work gains an owner outside yourself — who is waiting, what you said, and whether you have moved the date — so you can walk into a conversation knowing rather than remembering.

**Architecture:** One new table, `commitments`, joining a task to a person with a promised date and the instant the promise was made. **Re-promising inserts a row rather than updating one**, so the table is its own history and "you have moved this twice" is a count, not a change log. A meeting's `## Actions` lines — already written, already unparsed — become proposed commitments the person accepts one at a time. Nothing is ever created silently and nothing leaves this machine.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint: no synchronous `setState` in effect bodies), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3 (`npx drizzle-kit generate --name <name>`), zod 4, Vitest 5 jsdom, `motion` 12.

**Spec:** `docs/superpowers/specs/2026-09-25-reliable-planner-design.md` (§5)

**Depends on:** the honest-forecast slice being merged first — the watch slice reads both, and `promisedFor` shares the week helpers.

## Global Constraints

- Carbon tokens only — `src/test/tokens.test.ts` bans `ink`, `slate`, `brass`, `paper`, `tone=`, `on-paper`, `shadow-dock`. Sentence case. `focus-ring` on every interactive element. `aria-label` on icon-only controls.
- No synchronous `setState` in an effect body (react-compiler lint).
- Tests never touch the network, never depend on the real clock, and never depend on the machine's timezone. Build date fixtures from local components.
- Migrations: `npx drizzle-kit generate --name commitments`. Never hand-edit the journal or the snapshot.
- Statuses are exactly `open`, `kept`, `missed`, `released`. `promisedFor` is a required `YYYY-MM-DD`; `promisedAt` is a UTC ISO instant.
- **Re-promising inserts; it never updates.** The current promise is the newest `open` row for the task. Every function that reads "the commitment" reads the newest.
- **Nothing is created without a click.** The meeting extraction proposes; a person accepts. No background job writes a commitment.
- **Nothing leaves the machine.** No email, no notification to the other person, no sharing. This is a private record of what you said.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/enums.ts`, `src/db/schema.ts`, `drizzle/00NN_commitments.sql` | `COMMITMENT_STATUSES`, the `commitments` table |
| `src/domain/commitments/index.ts` (+ test) | promise, re-promise, close, read, the counts |
| `src/lib/dto.ts`, `src/lib/api.ts`, `src/lib/validation.ts` | `CommitmentDTO`, `TaskDTO.commitment`, serializer, bodies |
| `src/app/api/commitments/route.ts`, `.../[id]/route.ts`, `src/app/api/commitments.test.ts` | the endpoints |
| `src/components/commitments/promise-button.tsx`, `commitment-chip.tsx`, `owed-list.tsx` (+ tests) | making one, seeing one, seeing them all |
| `src/components/person-editor.tsx` or the person page | what you owe this person |
| `src/lib/meeting-actions.ts` (+ test) | reading `## Actions` into proposals |
| `src/components/meeting/actions-pane.tsx` (+ test) | accepting them, one at a time |
| `README.md` | one section |

---

### Task 1: The table, the domain, the payloads, the routes

**Files:**
- Modify: `src/db/enums.ts`, `src/db/schema.ts` (+ generated migration), `src/lib/dto.ts`, `src/lib/api.ts`, `src/lib/validation.ts`
- Create: `src/domain/commitments/index.ts`, `src/domain/commitments/index.test.ts`, `src/app/api/commitments/route.ts`, `src/app/api/commitments/[id]/route.ts`, `src/app/api/commitments.test.ts`

**Interfaces:**
- Consumes: `getTask` from `@/domain/tasks`; `getPerson` from `@/domain/people`; `crossSite`, `forbidden`, `errorResponse`, `parseId` from `@/lib/api`.
- Produces:
  - `src/db/enums.ts`: `COMMITMENT_STATUSES = ["open", "kept", "missed", "released"] as const` and `CommitmentStatus`.
  - Schema:
    ```ts
    /**
     * What you told someone you would do, and by when. Re-promising a date inserts another row
     * rather than editing this one: the table is its own history, so "you have moved this twice"
     * is a count and there is no separate change log to keep honest.
     */
    export const commitments = sqliteTable(
      "commitments",
      {
        id: integer("id").primaryKey({ autoIncrement: true }),
        taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
        personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
        /** The day you said. Deliberately not `tasks.dueDate`: one is when a thing is due, the
         * other is what you told a person, and the difference matters exactly when it matters. */
        promisedFor: text("promised_for").notNull(),
        /** When you said it — or moved it. */
        promisedAt: text("promised_at").notNull(),
        note: text("note").notNull().default(""),
        status: text("status", { enum: COMMITMENT_STATUSES }).notNull().default("open"),
        closedAt: text("closed_at"),
      },
      (t) => [index("commitments_task_idx").on(t.taskId), index("commitments_person_status_idx").on(t.personId, t.status), index("commitments_for_idx").on(t.promisedFor)],
    );
    ```
  - `src/domain/commitments/index.ts`:
    - `class CommitmentError extends Error { status: number }`
    - `promise(db, { taskId, personId, promisedFor, note? }, now?): Commitment` — inserts. If an open commitment already exists for that task **and person**, this is a re-promise: the old row is closed as `released` and a new one inserted, in one transaction.
    - `currentFor(db, taskIds: number[]): Map<number, Commitment>` — the newest open row per task, one grouped query.
    - `moveCount(db, taskId, personId): number` — how many times the date has been set for that pair; one is a promise, more is a move.
    - `closeCommitment(db, id, status: "kept" | "missed" | "released", now?): Commitment` — `kept` and `missed` may be decided automatically from `promisedFor` against the day it closed; see the ruling below.
    - `settleForTask(db, taskId, now?): void` — called when a task is completed: any open commitment closes as `kept` if the day is on or before `promisedFor`, `missed` otherwise.
    - `owedTo(db, personId): { open: Commitment[]; overdue: Commitment[]; kept: number; missed: number }`
    - `dueBy(db, through: string): Commitment[]` — open commitments promised on or before a day, for the watch slice.
  - DTOs: `CommitmentDTO { id, taskId, taskTitle, person: { id, name, slug }, promisedFor, promisedAt, note, status, moves }`; `TaskDTO.commitment: CommitmentDTO | null`.
  - Routes: `GET/POST /api/commitments`, `PATCH/DELETE /api/commitments/[id]`.

- [ ] **Step 1: Write the failing domain test**

Create `src/domain/commitments/index.test.ts` using `makeTestDb()` with `afterEach(cleanup)`, the shape `src/domain/goals/index.test.ts` uses. The history-by-insertion rule is the heart of it:

```ts
it("a second promise to the same person moves the date and keeps the first as history", () => {
  const t = createTask(db, { title: "Draft the brief" });
  const anita = createPerson(db, { name: "Anita" });
  promise(db, { taskId: t.id, personId: anita.id, promisedFor: "2026-10-01" }, at("2026-09-25"));
  promise(db, { taskId: t.id, personId: anita.id, promisedFor: "2026-10-08" }, at("2026-09-30"));

  const rows = db.select().from(commitments).where(eq(commitments.taskId, t.id)).all();
  expect(rows).toHaveLength(2);
  expect(rows.filter((r) => r.status === "open")).toHaveLength(1);
  expect(currentFor(db, [t.id]).get(t.id)).toMatchObject({ promisedFor: "2026-10-08" });
  expect(moveCount(db, t.id, anita.id)).toBe(2);
});

it("keeps two people's promises on one task apart", () => {
  // Promising the same task to a second person is a new commitment, not a move of the first.
});

it("settles as kept when the task closes on the promised day, missed the day after", () => {
  // Both directions, and the boundary is the promised day itself, inclusive.
});

it("counts what is owed and what is overdue for a person", () => {
  // `overdue` is open and promisedFor before today; `kept`/`missed` are lifetime counts.
});

it("refuses a promise to a person or task that is not there", () => {});
it("refuses a promised date that is not a real calendar day", () => {});
it("takes the commitments with the task when the task is deleted", () => {});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/commitments/index.test.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Enums, schema, migration**

Then `npx drizzle-kit generate --name commitments`. Commit the SQL, journal and snapshot exactly as generated.

- [ ] **Step 4: Write the domain module**

`promise` in one transaction:

```ts
return db.transaction((tx) => {
  // A second promise to the same person is that promise moving, not a new one. Closing the old
  // row as "released" rather than editing it is what makes the table its own history.
  const live = openFor(tx, input.taskId, input.personId);
  if (live) tx.update(commitments).set({ status: "released", closedAt: now.toISOString() }).where(eq(commitments.id, live.id)).run();
  return tx.insert(commitments).values({ …, promisedAt: now.toISOString() }).returning().get();
});
```

`currentFor` must be one grouped query for a list of task ids, never one per task. `focusMinutesByTask` and `goalRefsByContainer` are the two patterns already in the repo; follow them.

**Validate the date as a real calendar day**, not a regex — `src/lib/validation.ts` gained `CalendarDateString` in the weekly-review slice for exactly this, because `2026-13-45` passes a regex and rolls over to February.

- [ ] **Step 5: Wire `settleForTask` into completion**

`completeTask` in `src/domain/tasks/index.ts` calls it, so finishing a task settles what was promised without anyone remembering to. Reopening a task reopens the most recent settled commitment. Test both.

- [ ] **Step 6: DTOs, serializer, validation, routes**

`serializeTask` gains a fifth argument `commitment: CommitmentDTO | null = null`, after `spentMinutes`, so no existing caller breaks — the goals slice added the third and the focus slice the fourth. `serializeTasks`/`serializePlanTasks` fill it from one `currentFor` call for the whole list.

Routes gate on `crossSite` and parse with `Schema.parse(await req.json().catch(() => null))`.

- [ ] **Step 7: Route test, then the suite**

`src/app/api/commitments.test.ts` in the shape of `src/app/api/goals.test.ts`, including its origin-guard and malformed-body cases.

Run: `npm test && npx tsc --noEmit && npm run lint`, plus `TZ=Pacific/Midway npm test`.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(commitments): what you told someone, and every time the date moved

<trailers>"
```

---

### Task 2: Making one, and seeing who is waiting

**Files:**
- Create: `src/components/commitments/promise-button.tsx`, `commitment-chip.tsx`, `owed-list.tsx`, and tests for the button and the list
- Modify: `src/components/tasks/task-row.tsx`, `src/components/planner/plan-pane.tsx`, the person page, `src/app/people/[slug]/page.tsx`

**Interfaces:**
- Consumes: `PeoplePicker` from `@/components/people-picker`; `useDialog` from `@/components/use-dialog`; `CommitmentDTO`.
- Produces: `<PromiseButton task />`, `<CommitmentChip commitment />`, `<OwedList personId />`.

- [ ] **Step 1: The control**

"Promised to…" on a task row opens a small dialog: a person, a date, and an optional line of what you actually said. It uses `useDialog` from the goals slice, so it gets `role="dialog"`, `aria-modal`, Escape, a focus trap and focus return for free — do not write a fourth dialog idiom.

When a commitment already exists the control reads the person's name and the date, and opening it offers a **new date**, with the existing one shown and a plain line: "Promised 1 October. Moving it is recorded." That sentence is the feature. It is not a warning and it is not hidden.

- [ ] **Step 2: The chip**

On a planned row and on the day's timeline, a faint chip naming the person and the day: "Anita · Fri". Nothing renders when there is no commitment — a row without one must look exactly as it does today, and that needs a test.

- [ ] **Step 3: What you owe a person**

The person page gains a section above their timeline: what is open, nearest date first, with anything overdue first and labelled; then one plain line, "11 of 12 kept." Not a score, not a streak, not a badge — a count, stated once. The research on streaks that shaped the goals slice applies here unchanged.

When nothing is owed the section renders nothing at all.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git commit -m "feat(commitments): promise from a task row, and see what a person is waiting for

<trailers>"
```

---

### Task 3: Commitments out of the meeting they were made in

**Files:**
- Create: `src/lib/meeting-actions.ts` (+ test), `src/components/meeting/actions-pane.tsx` (+ test)
- Modify: `src/components/meeting/meeting-page.tsx`, `README.md`

**Interfaces:**
- Produces: `parseActions(body: string): { text: string; mention: string | null; date: string | null }[]`, and the pane that turns each into a commitment.

- [ ] **Step 1: Read the Actions section**

`src/lib/planner.ts` already has `ACTIONS_HEADING` and `EMPTY_ACTION` and uses them to decide whether a meeting has notes. Reuse those, do not write a second pair.

`parseActions` returns one entry per non-empty action line: the text with any checkbox marker stripped, a `@mention` if the line has one (`extractMentions` in `src/domain/people/index.ts` already exists — use it), and a date if the line says one in a form the existing quick-parse understands (`src/domain/tasks/quick-parse.ts`; reuse whatever date reading it already does rather than writing a parser).

Everything here returns `null` rather than guessing. A wrong person on a commitment is worse than no person.

- [ ] **Step 2: The pane**

On a meeting page with a non-empty Actions section, a pane lists each line with: the text, a person picker pre-filled from the mention **or from the meeting's attendees when exactly one attendee matches**, a date field pre-filled from the line, and two buttons — "Make a commitment" and "Dismiss".

Nothing is created until a button is pressed. Dismissing hides the line for that session only; it does not edit the note.

A line that becomes a commitment also becomes a task, so there is something to plan. Use `createTask` with `sourceItemId` set to the meeting item, which the task domain already supports and nothing currently uses from a meeting.

- [ ] **Step 3: The empty and the awkward cases**

Test: no Actions heading at all renders nothing; a heading with only the seeded empty `- [ ]` renders nothing; a line with no mention and three attendees leaves the person blank rather than picking one; a line with a mention naming nobody in the app leaves it blank.

- [ ] **Step 4: README**

A Commitments section: what one is, that moving a date is recorded, where they come from, that closing a task settles them, and that nothing ever leaves the machine. Match the voice of the Goals and Focus sections.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus the `TZ` run.

```bash
git commit -m "feat(commitments): a meeting's actions become promises before anyone leaves the room

<trailers>"
```
