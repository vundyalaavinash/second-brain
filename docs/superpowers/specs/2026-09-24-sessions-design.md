# Sessions and auto-place — design

Date: 2026-09-24. Builds on time-blocking (`2026-09-23-time-blocking-design.md`): a task held one block start; now it holds sessions, and the app can place them into the day's free slots.

## 1. Purpose

A two-hour task rarely fits one gap. The plan should let a task be split into sessions and put those sessions where the calendar has room, in order, without the person dragging each one. Everything a person could do by hand (place, move, resize, remove a session) stays possible on each session.

## 2. Sessions

- A **session** is one block on the timeline: `task_blocks(id, task_id, starts_at, minutes)`. A task may hold any number; they are its `blocks`, ordered by start. The old `tasks.scheduled_at` becomes the first block (migrated with `minutes = estimate ?? 25`) and the column is dropped.
- The task's **estimate** stays the total. Its **session length** (`tasks.session_minutes`, nullable) is how long each placed session should be; unset means "the whole estimate in one session when it is 60 minutes or less, otherwise 45-minute sessions". The last session takes the remainder; a remainder under 15 minutes joins the previous session.
- Completing the task is one act (row checkbox or any session's checkbox) and marks every session done in look. Unplanning the task from a day removes that day's sessions; carry-over removes the sessions of the day being left. Deleting a task cascades.
- Sessions on the timeline read "Write the launch note · 2 of 3" when the task has more than one on that day.

## 3. Placing

- **Free slots** for a day are the working hours minus timed, non-declined meetings and minus every existing session of every task on that day, merged, clipped to the hours, starting no earlier than now on today (rounded up to the next five minutes). Slots shorter than 15 minutes are ignored.
- **Place in free slots** (a row's menu, and `f` on a focused plan row) removes the task's existing sessions on that day and lays fresh ones earliest first: session length from §2, a slot shorter than a session gets a session as long as the slot (never under 15), a session never straddles a meeting or another session, all snapped to five minutes. Sessions are placed until the estimate is covered or the day runs out. A task without an estimate places one 25-minute session.
- **Fill the day** (plan menu) runs the same for every open plan task that has no session on the day yet, in plan order.
- What does not fit is **unplaced**: per task, `estimate − minutes placed on the day`. The header's capacity line adds "· 1h 20m unplaced" when any; the toast after a place action says "Placed 3 sessions, 1h 20m unplaced" with an action "Place tomorrow", which runs the same placement for the next day after planning the task there.
- A **dropped** plan row still places exactly one session where it was dropped (length: session length from §2, or the whole estimate if smaller). A task dropped with **no estimate** opens the block's length presets (15, 25, 45, 60, 90, 120) at once, and the choice becomes the task's estimate and the session's length.

## 4. Editing sessions

Everything time-blocking gave a block, a session keeps: pointer drag to move, bottom-edge resize (writes that session's minutes; the task's estimate is left alone unless it is smaller than the sum of sessions, in which case it grows to match), arrows and Alt-arrows, Backspace or "Take this session off". "Take off the timeline" on the row removes all of the day's sessions. "Split into" on the row menu offers 25, 45, 60, 90 minutes and "One session", and re-places the task if it already has sessions that day.

## 5. Capacity and rows

- `blockedMinutes` = sum of session minutes on the day for open tasks; `unplacedMinutes` = sum over open plan tasks with an estimate of `max(0, estimate − blocked on the day)`. Both on the day payload; the week gets `blockedMinutes` as now.
- A plan row's time chip shows the first session's start and, with more than one, "+2"; clicking scrolls to the first session. The chip is a plain label outside the Day view.
- The picker and the prompt bar accept "~2h/45m": estimate two hours, sessions of 45 minutes.

## 6. Data and API

- Migration `0011_task_blocks`: create `task_blocks` (id, task_id references tasks on delete cascade, starts_at text not null, minutes integer not null; index on task_id and on starts_at), add `tasks.session_minutes integer`, copy each `scheduled_at` into a block, drop `tasks.scheduled_at`.
- DTOs: `BlockDTO { id, taskId, startsAt, minutes }`; `TaskDTO.blocks: BlockDTO[]` (ordered by start), `TaskDTO.sessionMinutes: number | null`; `scheduledAt` removed. `CapacityDTO.unplacedMinutes`.
- Routes: `POST /api/blocks { taskId, startsAt, minutes }`, `PATCH /api/blocks/[id] { startsAt?, minutes? }`, `DELETE /api/blocks/[id]`, `DELETE /api/tasks/[id]/blocks?date=` (that day's sessions), `POST /api/plan/place { date, taskId? }` → `{ placed: number; unplacedMinutes: number }`. `PatchTaskBody` accepts `sessionMinutes` (15–480 or null).
- Pure scheduler in `src/lib/scheduler.ts`: `freeSlots(busy: Span[], workHours, date, notBefore?)`, `sessionsFor(estimate, sessionMinutes)`, `placeSessions(slots, sessions, snap)` returning placed spans and leftover minutes. Domain `src/domain/blocks/` wraps the table and `placeTask(db, {taskId, date, now})` / `fillDay(db, {date, now})`.

## 7. Chrome, motion, accessibility

Sessions use the block look with the "n of m" mark in mono; a freshly placed set fades in with the layout animation. Every action has a keyboard path (`f`, the row menu, Backspace on a session). The place toast carries the unplaced figure and its action. Tokens only; sentence case; focus rings.

## 8. Testing

Scheduler: slots around meetings and sessions, clipping, the 15-minute floor, the remainder rule, now-rounding on today, nothing before now. Domain: place and fill, re-place replaces, unplanned days untouched, cascade on delete, migration copies a start. Routes: bodies and 400s. Timeline: sessions render with marks, session-level move/resize/remove, ask-on-drop presets. Rows and plan: Split into, Place in free slots, `f`, Fill the day, chip with "+2", header unplaced figure, toast action. Parser: "~2h/45m".

## 9. Implementation order

One plan, four tasks: (1) data, migration, scheduler, domain, routes, DTOs, capacity figures; (2) timeline and block on sessions, ask on drop; (3) row and plan actions, `f`, chip, header figure, toast with Place tomorrow; (4) picker and prompt syntax, README, Week unchanged.
