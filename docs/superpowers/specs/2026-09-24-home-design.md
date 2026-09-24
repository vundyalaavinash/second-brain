# Home — design

Date: 2026-09-24. A home page that shows where the day stands, built from data the app already holds. Depends on sessions (`2026-09-24-sessions-design.md`) for "Place in free slots" and the block chips.

## 1. Purpose

`/` currently redirects to the Inbox. The person wants one screen with the full view: what is happening now, what the day holds, what the projects need, what was touched last, and how the day has gone. Home is that screen. It reads; the actions on it are the same ones the Planner and the task rows already have.

## 2. Layout

Two columns from 1100 px (left wider), stacked below with the top band and Now first.

- **Top band.** The Planner's date numeral and weekday; the capacity line (planned against free, blocked, unplaced, meetings) with the hours chip; three figures as links: "3 planned" → `/planner`, "2 meetings" → `/planner/meetings`, "4 in the inbox" → `/inbox`. Figures of zero read "Nothing planned", "No meetings", "Inbox clear".
- **Now and next** (left, first). The current item: a meeting in progress (title, ends at, Join, Record or the recording chip state) or a session in progress (title, ends at, the block's checkbox), else "Nothing on right now". Then the next two timed items today in start order, each with its start. When nothing is placed and a planned task has an estimate, a line "Nothing placed yet" with a "Place in free slots" button that runs Fill the day.
- **Today's plan** (left). The plan rows as the Planner shows them (checkbox, title, chips, row menu, `p`/`n`/`f`), the capacity bar, and the plan picker under them. No ritual strip and no timeline on Home; "Open the Planner" links to `/planner`.
- **Projects in motion** (right). Active projects, at most six, as compact cards: name (link), open task count with the progress figure, the next open task's title, and the deadline in mono when set, coloured `warn` inside seven days and `danger` when past. Sorted by nearest deadline, then most recently updated. "All projects" links to `/projects`. Empty: "No active projects".
- **Recent** (right). The last five items touched (notes, links, captures, meetings; by `updatedAt`), each with its type icon, title (link) and "2 h ago" in mono; the last recorded meeting is included with its transcript or summary state as a chip. Empty: "Nothing captured yet".
- **Activity today** (right). Active time so far and the top three apps or sites by time, as one mono line each; a link to `/activity`. Hidden when the helper is not installed.

## 3. Data

`GET /api/home` returns `HomeDTO`:

```
{
  date, today,
  day: PlannerDayDTO,                 // plan, sources, capacity, meetings, calendar (reused as is)
  counts: { planned, meetings, inbox },
  now: HomeItemDTO | null,           // { kind: "meeting" | "session", title, startsAt, endsAt, meetingId?, joinUrl?, taskId?, blockId? }
  next: HomeItemDTO[],                // up to two
  projects: ProjectCardDTO[],         // { id, name, slug, open, done, nextTask: { id, title } | null, deadline, updatedAt }
  recent: RecentItemDTO[],            // { id, type, title, updatedAt, status, meeting?: { hasTranscript, hasSummary } }
  activity: { activeMs, top: { label, ms }[] } | null,
}
```

`homePayload(db, now)` in `src/lib/home.ts` builds it from `plannerDay`, `listContainers` + `projectProgress` + `listTasks`, `listItems` (limit 5, order by `updatedAt`), `getDay` from the activity report. The page is server-rendered with the payload and refreshes on `sb:plan-changed`, `sb:tasks-changed`, `sb:inbox-changed`, `sb:recording-changed` with the same debounce and request token as the Planner shell.

## 4. Navigation

`/` renders Home; `/today` redirects to `/`. `NAV_ITEMS` gains Home first (`g h`, icon "home", section "brain"); the dock shows it first; the breadcrumb reads "Home" with no parent. The command palette lists it with the other views.

## 5. Chrome, motion, accessibility

Tokens only; the numeral in `font-doc`; cards are `pane`; every link and button `focus-ring`; the Now item is a `role="status"` region updated on change only; sentence case; reduced motion honoured (the only motion is the plan rows' existing layout animation).

## 6. Testing

`home.test.ts`: counts, now and next selection (a meeting in progress wins over a session; the next two exclude the current), project sort and card fields, recent order and the meeting chip, activity top three, hidden activity without a helper. Route test for `/api/home`. Component tests (jsdom): top band figures and their links, Now states (meeting, session, nothing, place button), plan rows checkable and the picker present, project cards and deadline tones, recent list, activity line, refresh on events. Nav: Home first, `g h`.

## 7. Implementation order

One plan, three tasks: (1) payload, route, nav, redirects; (2) the page and its sections; (3) polish: refresh flow, tones, empty states, README.
