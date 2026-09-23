# Planning desk — design

Date: 2026-09-23. Builds on `2026-09-22-planner-design.md` (Day, Week, Meetings, recording) and the Carbon shell.

## 1. Purpose

Today a task can only be planned from wherever it already sits: "Plan for today" in a row menu in the Inbox, a project, or an area. The Day view shows the result but offers nothing to build it from except what is already due. There is no place to sit down, see everything, and compose the day. This slice makes the Day view that place:

- a **sources drawer** beside the plan that lists every open task by where it lives, with one-click add and drag-to-plan;
- **estimates and capacity**, so the plan is measured against the free time the calendar leaves;
- a **morning ritual** that walks an empty day through carry-over, due work, and picking from projects;
- **keyboard** planning from any task row and from the command palette.

Time-blocking tasks onto the timeline is deliberately left for a later slice; it needs estimates and a drawer first.

## 2. Where it lives

Everything stays under `/planner`. The Day view becomes three regions above 1280 px: the timeline (left), the plan (centre), and the sources drawer (right). Between 1100 and 1280 px the drawer collapses to a toggle in the plan header and opens as an overlay panel from the right edge. Below 1100 px the regions stack: plan, then timeline, then the drawer as a collapsed section.

The Week view gains a capacity line per column; planning from the Week view stays as it is (the row's "Plan for" list).

## 3. Sources drawer

A `pane` headed by a tablist (`role="tablist"`, arrow keys move between tabs, the active tab in violet): **Inbox**, **Due**, **Projects**, **Areas**, **Search**.

- **Inbox**: open tasks with no container, newest first.
- **Due**: open tasks due on or before the selected day that are not on the plan (overdue first, in danger; then due that day, in warn), the same partition the plan pane shows today. This section moves out of the plan pane into the drawer; the plan pane keeps only the plan and the carry-over banner.
- **Projects** and **Areas**: active containers of that kind, each a collapsible group (`<details>`) headed by the container name in `font-doc` and its open-task count in mono; groups with no open tasks are listed last and collapsed. Inside, the container's open tasks in their own sort order.
- **Search**: an `Input type="search"` that filters every open task by title across all sources; results are grouped by container name. Empty query shows the hint "Type to search every open task".

Each row is a `TaskRow` in `compact` mode with two additions: a leading **add** button (`+`, `aria-label="Plan <title> for <day>"`) and a `draggable` handle. A task already on the day's plan shows a violet check in place of `+` and its row is dimmed; clicking the check unplans it. The drawer shows counts in each tab label ("Inbox 4"). A tab with nothing to offer says so in one line ("Nothing in the inbox", "Nothing due", "No active projects").

The drawer remembers its active tab per browser (`localStorage`, key `sb:planner-source-tab`), defaulting to Due when anything is due and Inbox otherwise.

Dragging: a row sets `dataTransfer` type `application/x-sb-task` with the task id, the same type the Week view uses. The plan list accepts the drop anywhere in its area (drop at the end) or between rows (drop at that index: `POST /api/plan` then `PATCH /api/plan` with the new order in one client call sequence). The plan list highlights its drop target with a violet hairline. Dragging a plan row back onto the drawer unplans it.

Data: one new payload builder `plannerSources(db, date)` in `src/lib/planner.ts` returning `{ inbox: TaskDTO[]; due: { overdue; today }; projects: SourceGroupDTO[]; areas: SourceGroupDTO[] }` where `SourceGroupDTO = { container: ContainerDTO; tasks: TaskDTO[] }`. Search runs client-side over the same payload (every open task is already in it). `GET /api/planner/day` gains `sources`; `PlannerDayDTO` gains `sources: PlannerSourcesDTO`. The drawer refreshes on `sb:tasks-changed` and `sb:plan-changed` like the plan pane.

## 4. Estimates and capacity

Tasks gain `estimate_minutes` (integer, nullable). It is set from the task row: a mono chip after the due chip showing "25m" or "1h 30m", empty state "est", click for a popover with presets 15, 25, 45, 60, 90, 120 and a free field; `PATCH /api/tasks/:id { estimateMinutes }` accepts 5–480 or null. The prompt bar's task intent parses a trailing "~25m" or "~1h" into the estimate (the way it already parses due dates), strips it from the title, and shows it in the intent chip.

**Capacity** for a day = working hours minus timed, non-declined meetings that overlap them (all-day events do not count; overlapping meetings are merged before subtracting). Working hours are a setting `planner.workHours`, default `09:00-18:00`, edited from a small "Hours" chip in the Day header. `GET/PATCH /api/settings/planner { workHours }`, validated `HH:MM-HH:MM`, start before end.

The Day header's mono line becomes a **capacity line**: "3 planned · 2h 10m of 4h 30m free · 4 meetings". Planned time is the sum of the plan's open tasks' estimates; tasks without an estimate count as 0 and the line adds "(2 unestimated)" when any exist. When planned time exceeds free time the number turns `warn`, and past 125 % `danger`, with a title "Plan is 40 min over the free time". The plan pane repeats the same figure as a thin progress bar under its heading (violet fill, warn or danger past capacity).

The Week view shows one line under each day number: "2h 10m / 4h 30m" in mono, with the same colouring, computed by `plannerWeek` per day from that day's plan and meetings.

`src/lib/capacity.ts` holds the pure functions: `freeMinutes(meetings, workHours, date)`, `plannedMinutes(tasks)`, `formatMinutes(n)` ("2h 10m", "45m", "0m"), and `capacityTone(planned, free)` returning `"ok" | "warn" | "danger"`.

## 5. Morning ritual

When the selected day is today and its plan is empty, the plan pane opens with a three-step strip instead of the "Nothing planned" line:

1. **Carry over** — "3 unfinished from yesterday" with **Carry over** and **Skip**. Absent when yesterday left nothing.
2. **Review what is due** — "2 overdue, 1 due today" with **Plan all** and **Skip**; Plan all adds them in due order.
3. **Pick from projects** — "Open the Projects tab and add what moves them forward" with **Open projects** (switches the drawer to Projects, focuses its first row) and **Done**.

Each step is a `hairline-row` with a mono step number; the current step in `text-fg`, finished steps struck through in `text-fg-faint` with a violet check. The strip collapses once every step is done or skipped, or once the plan has any task, and does not return that day (`localStorage` key `sb:ritual-done:<date>`). On another day than today, or with the plan already started, the empty state stays the one line it is now, reworded: "Nothing planned. Add from the sources on the right, or press p on any task."

## 6. Keyboard and palette

- **`p` on a focused task row** (checkbox, title, or a chip has focus) plans the task for today anywhere in the app; on the Planner it plans for the selected day. Rows already planned unplan on `p`. The row announces the change through its existing live status ("Planned for today"). Inside the Inbox processor, whose own `p` opens the project picker, the row shortcut is not registered.
- **`⌘K`** gains a **Plan** section listing open tasks by title match ("Plan: Write the release note"), enter plans it for today and toasts "Planned for today". The section appears only when the query is at least two characters.
- **Drawer**: `⌘/` toggles the drawer; within the drawer, `Enter` on a focused row plans it and moves focus to the next row, so a list can be planned by holding Enter.
- The `g d` chord and the dock item still open the Day view.

## 7. Chrome and motion

Tokens only. The drawer is a `pane`; tabs are `Chip`s with `role="tab"`. Rows added to the plan slide in with the list's existing `motion` layout animation (200 ms, `prefers-reduced-motion` honoured); the ritual strip collapses with a height spring. The capacity bar animates its width on change. No new fonts or colours.

## 8. Data and API

- Migration `0009_planner_desk`: `tasks.estimate_minutes integer` nullable.
- `TaskDTO.estimateMinutes: number | null`; `TaskBody`/patch accept `estimateMinutes`.
- `PlannerDayDTO` gains `sources`, `capacity: { freeMinutes, plannedMinutes, unestimated, workHours }`; `PlannerWeekDayDTO` gains `capacity: { freeMinutes, plannedMinutes }`.
- New: `GET/PATCH /api/settings/planner`. Existing plan routes are reused for add, remove, reorder, carry-over; "Plan all" is a client loop over `POST /api/plan` followed by one reorder.
- Intent parser: `~<n>m` / `~<n>h` / `~<n>h<m>m` suffix on task intents.

## 9. Accessibility

Tablist with roving focus; every add button labelled with the task and the day; drag has a keyboard equivalent (add button and `Enter`); the capacity line is a `role="status"` region updated only on change (no per-second content); the ritual strip is an `<ol>` with `aria-current="step"`; colour never carries meaning alone (the over-capacity state also says so in text).

## 10. Testing

- `capacity.test.ts`: free minutes with overlapping and out-of-hours meetings, all-day ignored, declined ignored; formatting; tones at 100 % and 125 %.
- `plannerSources` and `plannerDay` builders: inbox, due partition, project and area groups ordered by open count, planned tasks flagged.
- Drawer (jsdom): tabs and counts, add and unplan, search grouping, remembered tab, drop into the plan at an index.
- Plan pane: ritual steps, Plan all order, strip collapse and persistence, capacity bar tone.
- Task row: estimate chip and popover, `p` shortcut plans and unplans, not registered inside the Inbox processor.
- Prompt bar intent: estimate suffix parsing.
- Palette: Plan section appears at two characters and plans on enter.
- Routes: settings validation, task patch bounds.

## 11. Implementation order

One plan, four tasks: (1) data and capacity: migration, DTOs, validation, `capacity.ts`, settings route, day and week payloads; (2) sources drawer and drop into the plan; (3) estimates in the row and prompt bar, capacity line and bars, hours chip; (4) ritual strip, keyboard, palette section, README.
