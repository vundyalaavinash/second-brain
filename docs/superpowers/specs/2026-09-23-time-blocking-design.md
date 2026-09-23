# Time-blocking — design

Date: 2026-09-23. Builds on the planning desk (`2026-09-23-planning-desk-design.md`) and the two-column Day view: timeline left, plan right, sources as a slide-over.

## 1. Purpose

The plan says what the day holds; the timeline says when the meetings are. Nothing yet says when the work happens. Time-blocking lets a planned task take a slot on the timeline, so the day reads as one sequence of meetings and work, the free time between meetings is spent on purpose, and the capacity line can say how much of the plan is placed.

## 2. What a block is

A block is a planned task with a start time. A task carries at most one `scheduledAt` (ISO local timestamp, e.g. `2026-09-23T10:30:00`); its length is its estimate, or 25 minutes when it has none. Blocks are only meaningful on the day of the plan they belong to, so `scheduledAt` is cleared when the task leaves the plan (unplan, carry-over to another day, done or dropped keeps it as history but the timeline no longer draws it). One task, one block: a task planned on two days keeps a single `scheduledAt`, which the timeline shows only on the matching day.

## 3. On the timeline

- **Placing.** Drag a plan row onto the timeline: a ghost block follows the cursor snapped to 5-minute steps; drop sets `scheduledAt` to the slot's start on the selected day. Dropping on an occupied slot is allowed; the task block shares the width with whatever overlaps, the way meetings already do.
- **Blocks.** A task block uses the meeting block's geometry with its own look: `bg-violet-dim` with a violet left rule, the title, the time range in mono, an estimate chip, and a checkbox that completes the task in place. Done tasks stay on the timeline dimmed with a strike; dropped ones disappear.
- **Moving and resizing.** Drag a block to move it (same snapping). A handle on its bottom edge resizes it; the new length is written back as the task's estimate (5 to 480). Keyboard: with the block focused, `ArrowUp`/`ArrowDown` move by 15 minutes, `Shift` plus arrows by 5, `Alt` plus arrows resize by 5, `Backspace` unblocks (keeps the task on the plan).
- **Unblocking.** A block's menu offers "Take off the timeline", which clears `scheduledAt`. Dragging a block back onto the plan list does the same.
- **Now.** A "Block now" action on a plan row's menu (and `n` with the row focused) sets `scheduledAt` to the current time rounded up to the next 5 minutes on today; it is disabled on other days.
- **Overlaps with meetings** are not prevented; they show side by side. The capacity arithmetic already counts meetings once, so blocks never change free time.

## 4. On the plan

- A blocked task's row shows a mono time chip ("10:30") after the estimate chip; clicking it scrolls the timeline to the block and flashes it. The chip is the same in the sources drawer.
- The plan keeps its manual order; blocks do not reorder rows. A "Sort by time" item in the plan header menu reorders the plan to follow block times (unblocked rows keep their relative order at the end).

## 5. Capacity

The header line gains a fourth figure: "3 planned · 2h 10m of 4h 30m free · 1h 20m blocked · 4 meetings". Blocked time is the sum of blocked open tasks' lengths on that day. The plan pane's bar shows blocked time as a brighter segment inside the planned fill. The Week view marks a day with blocks with a small violet dot after its capacity line and a title "1h 20m blocked".

## 6. Data and API

- Migration `0010_task_scheduled_at`: `tasks.scheduled_at text` nullable.
- `TaskDTO.scheduledAt: string | null`; `TaskBody`/`PatchTaskBody` accept `scheduledAt` (`YYYY-MM-DDTHH:MM:SS` local, validated with the existing local-timestamp regex, or null). `updateTask` validates the format; the domain clears `scheduledAt` in `removeFromPlan` and in `carryOver` for tasks that move.
- `PlannerDayDTO.capacity.blockedMinutes: number`; `PlannerWeekDayDTO.capacity.blockedMinutes: number`. `blockedMinutes(tasks, date)` in `src/lib/capacity.ts` counts open tasks whose `scheduledAt` falls on `date`, using estimate or 25.
- `POST /api/plan/sort` `{ date }` reorders the plan by block time (server side, `sortPlanByTime(db, date)`).
- The timeline reads task blocks from `day.plan` (it already receives the day's meetings; it now also receives `tasks: PlanTaskDTO[]` and the callbacks to patch).

## 7. Chrome, motion, accessibility

- Ghost block while dragging: `border border-dashed border-violet bg-violet-dim/50`; snapping visible as the ghost jumps. Blocks animate their `top`/`height` with the layout animation (200 ms, reduced motion honoured).
- Every block is a focusable `button`-like region with an accessible name "Write the launch note, 10:30 to 11:15" and a `role="group"` around its controls; keyboard moves announce through the existing `sb:toast` ("Moved to 10:45").
- Drag has keyboard equivalents for everything (arrows, Block now, Take off the timeline).
- Tokens only; sentence case; focus rings.

## 8. Testing

- `capacity.test.ts`: `blockedMinutes` on the day, other days ignored, done tasks ignored, estimate fallback.
- Domain: `scheduledAt` set/cleared through `updateTask`, cleared by `removeFromPlan` and `carryOver`, `sortPlanByTime` order.
- Timeline (jsdom): a task block renders from `day.plan`, drop from the plan list writes `scheduledAt` at the snapped slot, arrow keys move by 15, `Backspace` unblocks, resize writes the estimate, done block dimmed.
- Plan pane: time chip, "Block now" on today only, "Sort by time".
- Header and week: blocked figure and dot.

## 9. Implementation order

One plan, three tasks: (1) data, domain, capacity, routes and DTOs; (2) timeline blocks: render, drop, move, resize, keyboard, unblock; (3) plan chips, Block now, Sort by time, header and week figures, README.
