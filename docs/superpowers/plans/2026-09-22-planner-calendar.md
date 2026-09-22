# Planner and Calendar Implementation Plan (Planner plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Planner section (Day, Week, Meetings views), the daily plan with carry-over, richer calendar events from the helper, and the calendar setup card, replacing the Today page.

**Architecture:** Migration 0007 adds the plan table and the calendar columns. The helper widens its EventKit window and posts richer events plus a `calendarsSeen` count. A `domain/plan` module owns the daily plan; `domain/activity/calendar.ts` gains the meetings listing. The Planner is a client shell with a `tablist` that switches three views, each fed by one server route; the dock's first item points at it. Recording and transcripts are plan 2 and are not touched here except for the badges' data shape.

**Tech Stack:** Next.js 16, React 19 (react-compiler lint), Tailwind 4, Drizzle + better-sqlite3 (migrations in `drizzle/`), zod 4, Vitest 5 (jsdom via `// @vitest-environment jsdom`), `motion`, `@phosphor-icons/react`, Swift 6 (helper).

**Spec:** `docs/superpowers/specs/2026-09-22-planner-design.md` (binding), sections 2, 3, 4, 8, 9, 10, 11, 12 item 1.

## Global Constraints

- Carbon tokens only; `.pane` / `.panel` / `.micro`; sentence case; no middle dots; `.micro` is the only uppercase; focus ring on every interactive element; motion under `motion-safe:` and `useReducedMotion()`.
- No `setState` synchronously in an effect body; external stores through `useSyncExternalStore`; hydration deterministic (`todayLocal()`, `formatDate()`, the hand-rolled weekday and month names in `src/components/activity/format.ts`; never `toLocale*` without a fixed locale).
- Dates: local calendar days `YYYY-MM-DD` via `localDay()` and `addDays()` from `src/domain/activity`; times shown as `HH:MM` mono.
- Behaviour freeze outside the files each task lists; every `aria-label`, `title`, `role`, and `disabled` condition preserved.
- The helper must still build (`cd helper/activity && swift build -c release`); its heartbeat and calendar posts stay backward compatible (new fields optional server-side).
- `npm test && npm run lint && npm run build` pristine at the end of every task. Do not start a server on port 3141; do not run `scripts/brain.sh`.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`.

---

## File structure

| File | Responsibility |
|---|---|
| `drizzle/0007_planner.sql`, `src/db/schema.ts` | `daily_plan_entries`; new `calendar_events` columns |
| `src/domain/activity/calendar.ts` (+test) | richer `CalendarEventInput`, `listMeetings`, `joinUrlFrom` |
| `src/domain/activity/helper-state.ts` | `calendarsSeen` |
| `src/app/api/activity/calendar/route.ts`, `status/route.ts`, `open-settings/route.ts` | accept the new fields; report `calendarsSeen`; open Internet Accounts |
| `helper/activity/Sources/sb-activity/CalendarReader.swift`, `main.swift` | 30/60-day window, new fields, `calendarsSeen`, `open-settings` command |
| `src/domain/plan/index.ts` (+test) | daily plan CRUD, reorder, unfinished, carry-over |
| `src/app/api/plan/route.ts`, `src/app/api/plan/carry-over/route.ts`, `src/app/api/planner/day/route.ts`, `src/app/api/planner/week/route.ts`, `src/app/api/meetings/route.ts` | Planner data |
| `src/lib/plan-date.ts` | external store: the Planner's selected date (for the prompt bar) |
| `src/components/planner/planner-shell.tsx`, `day-view.tsx`, `timeline.tsx`, `timeline-layout.ts` (+test), `plan-pane.tsx`, `week-view.tsx`, `meetings-view.tsx`, `meeting-row.tsx`, `setup-card.tsx`, `date-header.tsx` | the Planner |
| `src/app/planner/page.tsx`, `src/app/planner/week/page.tsx`, `src/app/planner/meetings/page.tsx`, `src/app/today/page.tsx` (redirect) | routes |
| `src/components/tasks/task-row.tsx`, `task-list.tsx`, `src/components/shell/prompt-bar.tsx`, `src/components/nav.ts`, `src/components/dock/dock.tsx`, `src/lib/breadcrumb.ts`, `src/components/icons.tsx` | integration |

---

### Task 1: Data, calendar depth, helper, setup signal

**Files:**
- Create: `drizzle/0007_planner.sql`, `src/app/api/activity/open-settings/route.ts`
- Modify: `src/db/schema.ts`, `src/domain/activity/calendar.ts`, `src/domain/activity/calendar.test.ts`, `src/domain/activity/helper-state.ts`, `src/app/api/activity/calendar/route.ts`, `src/app/api/activity/status/route.ts`, `src/lib/dto.ts`, `helper/activity/Sources/sb-activity/CalendarReader.swift`, `helper/activity/Sources/sb-activity/main.swift`

**Interfaces:**
- Produces: `CalendarEventInput` with optional `organizer`, `attendeeNames: string[]`, `location`, `joinUrl`, `notes`, `allDay`, `status: "accepted" | "tentative" | "declined" | "none"`, `calendarTitle`; `joinUrlFrom(...texts: (string | null | undefined)[]): string | null`; `listMeetings(db, { from, to, q? }): CalendarEvent[]` (ordered by `startsAt`, `q` matches title, organizer, attendee names, case-insensitive); `HelperState.calendarsSeen: number | null`; `ActivityMeetingDTO` gains `organizer`, `attendeeNames`, `location`, `joinUrl`, `allDay`, `status`, `calendarTitle`, `noRecord`; `POST /api/activity/open-settings` (helper token not required; runs `open "x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension"` via `child_process.execFile`, returns 204); the `daily_plan_entries` table.

- [ ] **Step 1: Failing tests**

Add to `src/domain/activity/calendar.test.ts` (reuse its in-memory db helper):

```ts
it("stores the richer fields and derives a join url", () => {
  replaceCalendarEvents(db, [{ externalId: "e1", title: "Sync", startsAt: "2026-09-22T09:00:00.000Z", endsAt: "2026-09-22T09:30:00.000Z", attendees: 3, hasCallLink: true, organizer: "Ada", attendeeNames: ["Ada", "Bo"], location: "Teams", joinUrl: null, notes: "Join: https://teams.microsoft.com/l/meetup-join/abc", allDay: false, status: "accepted", calendarTitle: "Work" }]);
  const [ev] = listMeetings(db, { from: "2026-09-22", to: "2026-09-23" });
  expect(ev.organizer).toBe("Ada");
  expect(JSON.parse(ev.attendeeNames)).toEqual(["Ada", "Bo"]);
  expect(ev.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/abc");
  expect(ev.status).toBe("accepted");
});
it("lists meetings in a window with a text filter", () => {
  // two events on different days, one titled "Design review" with attendee "Cy"
  expect(listMeetings(db, { from: "2026-09-20", to: "2026-09-30", q: "cy" }).map((e) => e.title)).toEqual(["Design review"]);
});
it("joinUrlFrom prefers meeting providers and falls back to any https url", () => {
  expect(joinUrlFrom("room 4", "https://zoom.us/j/1", "see https://example.com")).toBe("https://zoom.us/j/1");
  expect(joinUrlFrom(null, "notes https://example.com/x")).toBe("https://example.com/x");
  expect(joinUrlFrom("nothing")).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/domain/activity/calendar.test.ts` — expected: FAIL (`listMeetings`/`joinUrlFrom` missing, columns unknown).

- [ ] **Step 3: Migration and schema**

```sql
-- drizzle/0007_planner.sql
ALTER TABLE `calendar_events` ADD `organizer` text DEFAULT '' NOT NULL;
ALTER TABLE `calendar_events` ADD `attendee_names` text DEFAULT '[]' NOT NULL;
ALTER TABLE `calendar_events` ADD `location` text DEFAULT '' NOT NULL;
ALTER TABLE `calendar_events` ADD `join_url` text;
ALTER TABLE `calendar_events` ADD `notes` text DEFAULT '' NOT NULL;
ALTER TABLE `calendar_events` ADD `all_day` integer DEFAULT 0 NOT NULL;
ALTER TABLE `calendar_events` ADD `status` text DEFAULT 'none' NOT NULL;
ALTER TABLE `calendar_events` ADD `calendar_title` text DEFAULT '' NOT NULL;
ALTER TABLE `calendar_events` ADD `item_id` integer REFERENCES `items`(`id`) ON DELETE SET NULL;
ALTER TABLE `calendar_events` ADD `no_record` integer DEFAULT 0 NOT NULL;
CREATE TABLE `daily_plan_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `task_id` integer NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `daily_plan_date_task_idx` ON `daily_plan_entries` (`date`, `task_id`);
CREATE INDEX `daily_plan_date_idx` ON `daily_plan_entries` (`date`);
```

Mirror the columns in `src/db/schema.ts` (`calendarEvents` gains the fields with the same defaults; `dailyPlanEntries` table exported with `DailyPlanEntry` type) and add the journal entry in `drizzle/meta/_journal.json` plus a `0007_snapshot.json` by running `npx drizzle-kit generate --name planner` **after** editing the schema, then replace the generated SQL with the file above if it differs only cosmetically (keep the generated snapshot).

`replaceCalendarEvents` maps the new fields (defaults when absent; `attendeeNames` stored as JSON text; `joinUrl = e.joinUrl ?? joinUrlFrom(e.location, e.notes)`; `hasCallLink = !!joinUrl || e.hasCallLink`); it must keep `item_id` and `no_record` across the day-replace: before deleting the day's rows, read `{ externalId, itemId, noRecord }` for those days and re-apply them when inserting. `captureMeeting` also sets `item_id` on the event; `findCapturedMeetingItem` reads `item_id` first and falls back to the `meta.calendarEventId` lookup.

```ts
const PROVIDER_RE = /https?:\/\/[^\s<>"')]*(?:teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com)[^\s<>"')]*/i;
const ANY_RE = /https?:\/\/[^\s<>"')]+/i;
export function joinUrlFrom(...texts: (string | null | undefined)[]): string | null {
  const joined = texts.filter(Boolean).join(" ");
  return joined.match(PROVIDER_RE)?.[0] ?? joined.match(ANY_RE)?.[0] ?? null;
}
export function listMeetings(db: DB, opts: { from: string; to: string; q?: string }): CalendarEvent[] {
  const rows = db.select().from(calendarEvents).where(and(gte(calendarEvents.day, opts.from), lt(calendarEvents.day, opts.to))).orderBy(asc(calendarEvents.startsAt)).all();
  const q = opts.q?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((e) => [e.title, e.organizer, e.attendeeNames].join(" ").toLowerCase().includes(q));
}
```

- [ ] **Step 4: Routes and DTO**

`POST /api/activity/calendar` body: the six existing fields plus `organizer: z.string().default("")`, `attendeeNames: z.array(z.string()).max(10).default([])`, `location: z.string().default("")`, `joinUrl: z.string().url().nullable().default(null)`, `notes: z.string().max(4000).default("")`, `allDay: z.boolean().default(false)`, `status: z.enum(["accepted","tentative","declined","none"]).default("none")`, `calendarTitle: z.string().default("")`, and a top-level `calendarsSeen: z.number().int().nonnegative().optional()` that the route stores through `recordHelperSeen`'s new `calendarsSeen` argument. `HelperState` gains `calendarsSeen: number | null` (setting key `activity.helper.calendarsSeen`). `GET /api/activity/status` returns it. `serializeMeeting` (wherever `ActivityMeetingDTO` is built in `src/lib/api.ts` or `report.ts`) adds the new fields; `ActivityMeetingDTO` in `src/lib/dto.ts` gains them.

`src/app/api/activity/open-settings/route.ts`: `POST` runs `execFile("open", ["x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension"])`, returns 204; errors → `errorResponse`.

- [ ] **Step 5: Helper**

`CalendarReader.swift`: `EventPayload` gains `organizer: String`, `attendeeNames: [String]`, `location: String`, `joinUrl: String?`, `notes: String`, `allDay: Bool`, `status: String`, `calendarTitle: String`. `upcoming(now:)` window: `start = now - 30 days` (start of day), `end = now + 60 days`; keep all-day events (they carry `allDay: true`); `organizer = e.organizer?.name ?? ""`; `attendeeNames = (e.attendees ?? []).prefix(10).compactMap { $0.name }`; `location = e.location ?? ""`; `joinUrl` from the same regex applied to `[e.url?.absoluteString, e.location, e.notes]` (first match, full URL: extend the regex to capture the whole `https?://\S+`); `notes = String((e.notes ?? "").prefix(4000))`; `status` from `e.status` (`.confirmed` → "accepted", `.tentative` → "tentative", `.canceled` → "declined", else "none"); `calendarTitle = e.calendar.title`. Add `var calendarsSeen: Int { store.calendars(for: .event).count }`. `main.swift`: the calendar post body becomes `{ events, calendarsSeen }`; post every 5 minutes instead of the current cadence (keep the first post at start); subscribe to `EKEventStoreChanged` via `NotificationCenter` to post again within 10 s of a change. Build with `swift build -c release` in `helper/activity` and paste the last lines of its output into the report.

- [ ] **Step 6: Run tests, lint, build, swift build; commit**

```bash
git add -A drizzle src helper
git commit -m "feat(planner): richer calendar events, daily plan table, calendar setup signal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Daily plan domain, APIs, "Plan for today", prompt bar planning

**Files:**
- Create: `src/domain/plan/index.ts`, `src/domain/plan/index.test.ts`, `src/app/api/plan/route.ts`, `src/app/api/plan/carry-over/route.ts`, `src/lib/plan-date.ts`
- Modify: `src/lib/validation.ts`, `src/lib/dto.ts`, `src/lib/api.ts`, `src/components/tasks/task-row.tsx`, `src/components/tasks/task-row.test.tsx`, `src/components/shell/prompt-bar.tsx`, `src/components/shell/prompt-bar.test.tsx`

**Interfaces:**
- Produces: `listPlan(db, date): (Task & { planId: number; sortOrder: number })[]`; `addToPlan(db, date, taskId): void` (idempotent; appends at the end); `removeFromPlan(db, date, taskId)`; `reorderPlan(db, date, taskIds: number[])`; `unfinished(db, date): Task[]` (open tasks on that date's plan); `carryOver(db, from, to): number` (adds every unfinished task of `from` to `to`, returns the count). Routes: `GET /api/plan?date=` → `{ date, tasks: TaskDTO[] (with planId, sortOrder), unfinishedYesterday: TaskDTO[] }`; `POST /api/plan { date, taskId }`; `DELETE /api/plan { date, taskId }`; `PATCH /api/plan { date, taskIds }`; `POST /api/plan/carry-over { from, to }` → `{ moved }`. Events: `sb:plan-changed`. `src/lib/plan-date.ts`: `setPlanDate(date | null)`, `usePlanDate()` (external store, server snapshot null). Task row menu gains "Plan for today" (and "Remove from plan" when the row is rendered with `planned` true).

- [ ] **Step 1: Failing tests**

```ts
// src/domain/plan/index.test.ts — same in-memory db helper as src/domain/tasks/index.test.ts
it("adds, orders, and carries over", () => {
  const a = createTask(db, { title: "A" }); const b = createTask(db, { title: "B" });
  addToPlan(db, "2026-09-21", a.id); addToPlan(db, "2026-09-21", b.id); addToPlan(db, "2026-09-21", a.id);
  expect(listPlan(db, "2026-09-21").map((t) => t.id)).toEqual([a.id, b.id]);
  reorderPlan(db, "2026-09-21", [b.id, a.id]);
  expect(listPlan(db, "2026-09-21").map((t) => t.id)).toEqual([b.id, a.id]);
  completeTask(db, b.id);
  expect(unfinished(db, "2026-09-21").map((t) => t.id)).toEqual([a.id]);
  expect(carryOver(db, "2026-09-21", "2026-09-22")).toBe(1);
  expect(listPlan(db, "2026-09-22").map((t) => t.id)).toEqual([a.id]);
  removeFromPlan(db, "2026-09-22", a.id);
  expect(listPlan(db, "2026-09-22")).toEqual([]);
});
```

`task-row.test.tsx`: the menu contains "Plan for today" and clicking it calls `onPlan`. `prompt-bar.test.tsx`: with `setPlanDate("2026-09-22")`, submitting `+ Call` posts the task and then `POST /api/plan` with `{ date: "2026-09-22", taskId }` and dispatches `sb:plan-changed`.

- [ ] **Step 2: Implement**

Domain per the interfaces (Drizzle over `dailyPlanEntries` joined to `tasks`; `sortOrder` = max + 1 on add; `reorderPlan` writes 0..n; `carryOver` uses `addToPlan`). Validation: `PlanBody = z.object({ date: DateString, taskId: z.number().int().positive() })`, `ReorderPlanBody`, `CarryOverBody`. `serializePlanTask`. Routes as listed.

`task-row.tsx`: new optional props `onPlan?: () => void` and `planned?: boolean`; menu item "Plan for today" (or "Remove from plan" when `planned`) between Rename and Move up; `task-list.tsx` passes `onPlan` that `POST`s `/api/plan` with `todayLocal()` then dispatches `sb:plan-changed` (no other change). `prompt-bar.tsx`: after a successful task submit, if `usePlanDate()` is non-null, `POST /api/plan` with that date and dispatch `sb:plan-changed`; the toast reads "Task added to today's plan" when the date is today, else "Task added and planned".

- [ ] **Step 3: Verify and commit**

```bash
git add -A src
git commit -m "feat(planner): daily plan domain and APIs, plan for today, prompt bar planning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: The Planner page (Day, Week, Meetings), routes, dock, redirect

**Files:**
- Create: `src/components/planner/planner-shell.tsx`, `date-header.tsx`, `day-view.tsx`, `timeline.tsx`, `timeline-layout.ts`, `timeline-layout.test.ts`, `plan-pane.tsx`, `week-view.tsx`, `meetings-view.tsx`, `meeting-row.tsx`, `setup-card.tsx`, `planner-shell.test.tsx`, `meetings-view.test.tsx`, `src/app/planner/page.tsx`, `src/app/planner/week/page.tsx`, `src/app/planner/meetings/page.tsx`, `src/app/api/planner/day/route.ts`, `src/app/api/planner/week/route.ts`, `src/app/api/meetings/route.ts`
- Modify: `src/app/today/page.tsx` (redirect to `/planner`), `src/components/nav.ts`, `src/components/dock/dock.tsx`, `src/components/icons.tsx`, `src/lib/breadcrumb.ts` (+test), `src/components/command-palette.tsx` (label), `src/components/today/*` (delete after the redirect lands; move `partitionDue` to `src/components/planner/partition.ts`)

**Interfaces:**
- Consumes: Task 1's `listMeetings`, `ActivityMeetingDTO` fields, `HelperState.calendarsSeen`; Task 2's plan APIs and `setPlanDate`.
- Produces: `GET /api/planner/day?date=` → `{ date, plan: TaskDTO[], unfinishedYesterday: TaskDTO[], due: { overdue: TaskDTO[]; today: TaskDTO[] }, meetings: ActivityMeetingDTO[], calendar: { calendarsSeen: number | null; permission: boolean } }`; `GET /api/planner/week?start=` → `{ start, days: { date, meetings, due }[] }`; `GET /api/meetings?from=&to=&q=` → `{ meetings: (ActivityMeetingDTO & { item?: { id, hasNotes, hasTranscript, hasSummary } })[] }` where the item flags come from the linked item's `body.trim().length > 0`, `meta.transcript`, `meta.summary`; `layoutBlocks(meetings, { dayStart, dayEnd }): { id, top, height, col, cols }[]` in `timeline-layout.ts` (minutes from `dayStart`; overlapping meetings share columns); `NAV_ITEMS[0] = { href: "/planner", label: "Planner", shortcut: "g d", icon: "planner", section: "brain" }`; dock icon `CalendarCheck`; `crumbsFor("/planner/week")` → `[{ label: "Planner", href: "/planner" }, { label: "Week" }]`.

- [ ] **Step 1: Failing tests**

`timeline-layout.test.ts`: two non-overlapping meetings get `col 0, cols 1`; two overlapping get `cols 2` with distinct `col`; a meeting before `dayStart` is clamped to `top 0`. `breadcrumb.test.ts`: the three Planner routes. `planner-shell.test.tsx` (jsdom, mocked `next/navigation`): renders the `tablist` with Day, Week, Meetings, `aria-selected` on the current one, and the segmented indicator moves (assert `aria-selected` only). `meetings-view.test.tsx`: given fixture meetings across three days, renders the "Today", date, and "Past 30 days" (collapsed) groups; typing in the search box filters rows; a row with `hasTranscript` shows the "Transcript" badge; the Join button has `href` = `joinUrl` and opens in a new tab.

- [ ] **Step 2: Implement**

`planner-shell.tsx` (client): `<Crumb>` per view; `DateHeader` (numeral, weekday, long date, mono summary line, previous/next/Today buttons; navigates with `?date=` on Day and `?start=` on Week); the segmented control: three `Link`s in a `pane rounded-full p-1` with `role="tablist"`, each `role="tab"` `aria-selected`; a `motion.span` `layoutId="planner-tab"` violet indicator behind the selected tab (`useReducedMotion` → no layout animation). Mounts `setPlanDate(date)` in an effect (cleanup sets null). Renders the `SetupCard` when `calendar.calendarsSeen === 0` or `!calendar.permission` (message per spec section 4, button `POST /api/activity/open-settings`).

`day-view.tsx`: grid `min-[1100px]:grid-cols-[3fr_2fr] gap-6`. `Timeline`: hour range from `min(7, earliest)` to `max(21, latest)`; hour rules with `HH:00` mono labels; the current-time line (violet, dot, updated every minute from `Date.now()` inside an interval in an effect that sets state from the timer callback); all-day strip; blocks positioned by `layoutBlocks` as `button`s (`aria-label` "Title, 10:30 to 11:00, 4 attendees[, recording]") with title, time, attendee count, Join (`a` with `target="_blank" rel="noreferrer"`, stops propagation), and badge dots; click → `POST /api/activity/meetings/<id>/capture` then `router.push('/items/<itemId>')`. `PlanPane`: `pane` with `.micro` "Plan", carry-over banner ("3 unfinished from yesterday" + "Carry over" button → `POST /api/plan/carry-over`), the plan as `TaskRow`s with the existing drag props wired to `PATCH /api/plan` reorder (same pattern as `task-list.tsx`), then `.micro` "Due" with `partitionDue`; refetches `/api/planner/day` on `sb:plan-changed` and `sb:tasks-changed`.

`week-view.tsx`: seven `pane` columns (`min-[1100px]:grid-cols-7`, else stacked), day number (today violet), meetings as compact rows (`HH:MM` + title, link to the meeting item via capture), due tasks as `TaskRow`s; drag between columns: `onDragStart` sets `text/task-id`, columns `onDrop` PATCH `/api/tasks/<id>` `{ dueDate }` then refetch; "Plan for" popover (a small `panel` with the seven weekdays) on each row via the row's `onPlan` (pass a date-taking variant `onPlanDate(date)`; `task-row` gets an optional `onPlanDate` prop that renders the popover instead of planning today when supplied).

`meetings-view.tsx`: search `Input`, groups (Today; each upcoming day; `details` "Past 30 days" collapsed), `MeetingRow`s (time range mono, title, organizer, attendee count, Join, "Don't record" toggle (`PATCH /api/meetings/<id> { noRecord }`, add that route to `src/app/api/meetings/[id]/route.ts`), badges Notes/Transcript/Summary, Record button that is a stub in this plan: disabled with `title="Recording arrives in the next update"`), "Record now" header button likewise disabled. Rows open the meeting item through the capture route.

Routes: `src/app/planner/page.tsx` etc. are server components that read `searchParams` (`date`, `start`), build the initial payload with the domain functions, and render `<PlannerShell view="day" initial={…} />`. `src/app/today/page.tsx`: `redirect("/planner")`. `nav.ts`, `icons.tsx` (`planner: CalendarCheck` in the dock map; lucide `CalendarCheck` in `icons.tsx`), `breadcrumb.ts`, the dock's `NARROW_ITEMS` filter (`/planner` replaces `/today`).

- [ ] **Step 3: Verify and commit**

`npm test && npm run lint && npm run build`; delete `src/components/today/` and its tests once nothing imports them.

```bash
git add -A src
git commit -m "feat(planner): day, week, and meetings views; dock points at the planner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Polish, setup, README, screenshots

**Files:**
- Modify: `scripts/brain.sh` (setup prints the Internet Accounts hint when the helper reports `calendarsSeen` 0 after its first post; `status` shows `calendars: N`), `README.md` (Planner paragraph under Features; the calendar setup step under Running it), `src/components/planner/*` for anything the screenshots show

- [ ] **Step 1: Sweep**

- Every Planner surface uses `pane` for panes and `panel` for popovers; `.micro` labels only for pane names; hover rows `bg-layer-2`; mono times.
- Empty states: Day plan "Nothing planned. Use Plan for today on any task, or add one below with +"; Week "No meetings this week"; Meetings "No meetings in the next 60 days" plus the setup card when `calendarsSeen` is 0.
- README: a "Planner" paragraph (Day, Week, Meetings, carry-over) and "Calendar: add your Microsoft 365 account in System Settings › Internet Accounts with Calendars on; the helper reads it through EventKit."
- `scripts/brain.sh status` prints `calendars: N` from `/api/activity/status`.

- [ ] **Step 2: Verify and commit**

`npm test && npm run lint && npm run build`; the controller screenshots Day, Week, Meetings at 1440 and 860 px and the setup card.

```bash
git add -A src scripts README.md
git commit -m "feat(planner): setup hints, empty states, README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: §2 dock item and Today redirect → Task 3; §3 Day/Week/Meetings → Task 3 (Record buttons stubbed pending plan 2, stated); §4 calendar depth, `calendarsSeen`, setup card, open-settings → Tasks 1 and 3; §8 data → Task 1 (plan table, calendar columns) and Task 2 (plan domain); §9 chrome and motion → Task 3 (segmented indicator, current-time line, violet drop line via existing drag) ; §10 a11y → Task 3 (tablist, block labels, Plan for popover); §11 tests → each task; §12 item 1 → this plan.
- Placeholders: none; the drag-and-drop reuses `task-list.tsx`'s existing pattern by reference to its file, with the reorder endpoint named.
- Type consistency: `listMeetings`, `joinUrlFrom`, `calendarsSeen`, `listPlan/addToPlan/removeFromPlan/reorderPlan/unfinished/carryOver`, `setPlanDate/usePlanDate`, `layoutBlocks`, `onPlan/onPlanDate/planned`, route shapes, `sb:plan-changed` are named identically across tasks.
