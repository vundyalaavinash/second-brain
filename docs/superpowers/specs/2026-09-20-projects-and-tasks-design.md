# Projects and tasks — design

Date: 2026-09-20. Extends `2026-09-12-second-brain-design.md` (sections 3 `tasks`, 5.1, 6) and inherits its architecture, copy rules, and visual direction. The activity tracker and rich notes specs (2026-09-16) are already built.

## 1. Purpose

The project pages are hollow: a project shows a goal, a deadline, a next-steps text box, and filed items. This slice builds the spec's task model and redesigns the project list and detail pages around progress, next actions, and deadlines. Areas get the same task list. The daily plan, Today and Upcoming views, and recurrence wait for a later slice; the column for recurrence is reserved now so that slice is additive.

## 2. Data model

### tasks

| Column | Notes |
|---|---|
| id | integer primary key |
| title | text, required, trimmed, non-empty |
| notes | markdown, default empty |
| status | `open`, `done`, `dropped` |
| priority | `low`, `normal`, `high`, default `normal` |
| due_date | `YYYY-MM-DD` or null |
| container_id | nullable reference to `containers`, `ON DELETE SET NULL`; null means Inbox |
| source_item_id | nullable reference to `items`, `ON DELETE SET NULL` |
| recurrence | text or null; reserved, never set by this slice |
| completed_at | ISO timestamp or null; set when status becomes `done`, cleared on reopen |
| sort_order | integer, manual order within a container (and within Inbox) |
| created_at, updated_at | ISO timestamps |

Indexes: `(container_id, status, sort_order)` and `(status, due_date)`.

Enums `TASK_STATUSES` and `TASK_PRIORITIES` in `src/db/enums.ts`; type `Task` exported from the schema.

### containers

`next_steps` is retired by a one-time migration (section 5). The column stays for now (dropping it is a later cleanup); the API stops accepting it and the UI stops rendering it.

### Derived: progress

For a container: `open`, `done`, `total = open + done` (dropped tasks are excluded everywhere), `percent = total ? round(done / total * 100) : 0`, and `nextTask` = the first open task by `sort_order`, then by earliest `due_date` with nulls last. Computed in one grouped query for lists.

## 3. Domain (`src/domain/tasks/`)

- `createTask(db, { title, containerId?, dueDate?, priority?, notes?, sourceItemId? }): Task` — validates the title and date, checks the container and source item exist, appends at `max(sort_order) + 1` within the container.
- `getTask(db, id)`, `listTasks(db, { containerId: number | null | undefined, status?: "open" | "done" | "dropped" | "all" })` ordered by status (open first), `sort_order`, id. `containerId: null` lists Inbox tasks; `undefined` lists all.
- `updateTask(db, id, patch: { title?, notes?, priority?, dueDate?: string | null, containerId?: number | null })` — moving containers appends to the end of the target's order.
- `completeTask(db, id)`, `reopenTask(db, id)`, `dropTask(db, id)`, `deleteTask(db, id)`.
- `reorderTasks(db, containerId: number | null, ids: number[])` — listed ids get positions 0..n-1 in order; unlisted open tasks of that container keep their relative order after them.
- `projectProgress(db, containerId): Progress` and `containerProgress(db, ids: number[]): Map<number, Progress>` (one query).
- `quickParse(title: string): { title: string; priority: "high" | "normal"; dueDate: string | null }` — pure function used by the client and tests: a leading or trailing `!` sets high priority; a trailing token of `today`, `tomorrow`, a weekday name or three-letter abbreviation (next occurrence, today counts if it is that weekday), or an ISO date sets `dueDate`; the token is removed from the title. `now` is injectable for tests.
- `TaskError extends Error { status }`: 400 for validation, 404 for unknown task, container, or source item.

## 4. API (`src/app/api/tasks/`)

| Route | Body / query | Response |
|---|---|---|
| `GET /api/tasks` | `container=<id>` or `container=inbox` (omit for all), `status=open` (default) `done` `dropped` `all` | `{ tasks: TaskDTO[], progress: ProgressDTO }` (progress only when a container is given) |
| `POST /api/tasks` | `{ title, containerId?, dueDate?, priority?, notes?, sourceItemId? }` | 201 `TaskDTO` |
| `PATCH /api/tasks/[id]` | any of `title, notes, priority, dueDate, containerId, status` (`status` routes to complete, reopen, or drop) | `TaskDTO` |
| `DELETE /api/tasks/[id]` | | 204 |
| `POST /api/tasks/reorder` | `{ containerId: number | null, ids: number[] }` | `{ tasks: TaskDTO[] }` |

`TaskDTO`: id, title, notes, status, priority, dueDate, containerId, sourceItemId, completedAt, sortOrder, createdAt, updatedAt. `ProgressDTO`: open, done, total, percent, nextTask (`{ id, title, dueDate } | null`).

`ContainerDTO` gains `progress: ProgressDTO`. `PATCH /api/containers/[id]` no longer accepts `nextSteps` (400 if sent).

Completing a project (`POST /api/containers/[id]/archive` with the dialog's choice): "Archive them with it" also drops remaining open tasks; the three move options move open tasks along with the items to the chosen container or to Inbox (`container_id` null).

Errors go through `errorResponse` with `TaskError` mapped.

## 5. Migration of next steps

`migrateNextSteps(db)` runs once at boot, guarded by settings key `tasks_migrated = "1"`:

1. For each container with non-empty `next_steps`, split into lines.
2. Lines matching `- [ ] text` or `- [x] text` (also `*` bullets, case-insensitive `x`) become tasks filed to that container, in file order, `done` when checked (with `completed_at = now`).
3. Remaining non-blank lines are appended to `description` under a trailing `## Notes` heading, unless the description already contains them.
4. `next_steps` is set to empty and the settings flag is written in the same transaction.

Idempotent: a second run finds the flag and does nothing.

## 6. UI

### Project list (`/projects`)

- `PageHeader` "Projects", meta "N active, M due this week" (mono numerals only).
- New-project form: one `Input` with placeholder "New project" and a primary "Add project" button.
- Cards in `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`, sorted overdue first, then nearest deadline, then no deadline, ties by name. Each `ProjectCard` is a single `Link` styled `rounded-lg border border-line bg-surface-1 p-5 hover:border-line-strong transition motion-safe:hover:-translate-y-0.5 focus-ring`:
  - Row one: a 36 px SVG `ProgressRing` (track `--color-line`, stroke `--color-accent`, 3 px, round caps) with the percent in mono beside it; on the right a deadline chip: "N days left" (muted), "Due today" (warn), "N days overdue" (danger), "No deadline" (faint). Singular forms ("1 day left").
  - Name at 15 px medium; goal beneath in muted, two-line clamp.
  - Hairline divider, then the next task line: an empty square glyph and the title, or "No open tasks" (faint), or "All done" (success) when total > 0 and open = 0.
  - Footer in mono 11 px faint: "8 tasks, 14 items" (task count = total; items = filed items).
- Empty state unchanged in wording.

### Project detail (`/c/[slug]`, kind project)

- Toolbar as today; the Complete button moves into the hero.
- Hero (`rounded-lg border border-line bg-surface-1 p-6 flex flex-col gap-4`): the editable name (existing 22 px title input); the goal as an editable single-line input at 15 px muted with placeholder "What does done look like?"; a row with a 56 px `ProgressRing` and "5 of 8 done" (mono numerals), the deadline control (a `Chip` showing "Due 28 Sep, 12 days left" or "Set a deadline" that reveals the date `Input` on click, with the same urgency colours as the cards), and the primary "Complete" button. Saving keeps the existing ⌘S and "Save changes" flow.
- Tasks: `SectionHeading count={open}` "Tasks" and the `TaskList` component (below). Then Notes (`SectionHeading` "Notes", the rich editor on `description`), then Items as today. The next-steps editor is removed.

### Area detail

The Tasks section is inserted between the standard field and Items; no ring. Instead of header meta, the Tasks heading shows the open count.

### `TaskList` component (`src/components/tasks/task-list.tsx`)

- Props: `containerId`, initial `tasks` and `progress` (from the page), `onProgress(progress)` so the hero ring updates.
- Rows (`role="list"` / `role="listitem"`): a real checkbox `input` (accent when checked, label = title); the title as a button that becomes an inline `Input` on click or Enter, saving on blur or Enter, cancelling on Escape; a priority chip only when not normal ("High" warn tint, "Low" faint); a due chip in mono ("Tue 23", danger when overdue, warn when today, "No date" hidden) that opens a date input on click; a drag handle (pointer sort within the open list); a kebab `IconButton` "Task actions" opening a `panel` menu: Rename, Set due date, Priority (three chips), Move up, Move down, Drop, Delete.
- Add row: an `Input` with placeholder "Add a task" and hint text "Enter to add. End with a day like fri or a date; start with ! for high priority." Enter creates via `quickParse`, clears, keeps focus. Empty input does nothing.
- Done: a disclosure button "N done" (`aria-expanded`) reveals struck-through rows with a "Reopen" action; dropped tasks are not shown (reachable later from Inbox tooling).
- All mutations are optimistic with rollback; a failure shows "Could not save that change" in danger under the list until the next success.
- Keyboard: the whole list is operable without a pointer (checkbox, title edit, menu actions, Move up and Move down).
- Copy: sentence case; buttons name the action; mono for counts and dates only.

### Progress ring

`ProgressRing({ percent, size, stroke })` in `src/components/tasks/progress-ring.tsx`: an SVG circle pair with `stroke-dasharray`, `role="img"`, `aria-label="{percent}% done"`, and a 300 ms transition on the dash offset honouring reduced motion.

## 7. Errors

- Task saves failing: optimistic rollback plus the error line.
- Reorder conflicts (two tabs): last write wins; the list refetches after every reorder.
- Migration failure: the transaction rolls back and boot logs the error; the flag stays unset so it retries next boot.

## 8. Testing

- Domain: create appends order; complete sets and reopen clears `completed_at`; drop excluded from progress; reorder with unlisted ids; `nextTask` ordering; `containerProgress` matches per-container `projectProgress`; `quickParse` cases (`!`, `fri`, `tomorrow`, ISO, none, title trimming); migration converts checked and unchecked lines, appends stray lines to the description, clears `next_steps`, and is idempotent.
- API: CRUD, 400 on empty title and bad date, 404 on unknown container, reorder, `status` routing in PATCH, container DTO carrying `progress`, `nextSteps` rejected.
- Component (jsdom): `TaskList` adds on Enter with quick-parse, toggles done with one PATCH, shows the error line on a failed PATCH and reverts.
- Browser pass by the controller: cards, hero, add and complete tasks, reorder, area page.

## 9. Implementation order

1. Schema, enums, migration file, domain with tests.
2. API routes, DTO changes, container archive behaviour, next-steps migration at boot.
3. Progress ring, project cards, projects page.
4. `TaskList`, project hero and detail layout, area page, removal of the next-steps editor, README.
