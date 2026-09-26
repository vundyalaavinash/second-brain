# The Meetings You Should Be In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app stops believing the wrong thing about every meeting, gives the
person a local decision the calendar cannot make for them, lets a meeting
belong to a project, and turns the transcript-plus-activity data this app
uniquely holds into a real audit of which recurring meetings are worth the
hour.

**Architecture:** `calendar_events.status` currently reads `EKEventStatus` (the
*event's* confirmed/tentative/cancelled state) and calls it the person's RSVP
— a straightforward bug, fixed at the source in the Swift helper by reading
the `isCurrentUser` attendee's real `participantStatus` instead. On top of the
now-correct calendar status sits a genuinely separate local decision
(`going`/`not-going`/`maybe`, plus a note), stored per occurrence and
optionally per series, following the exact pattern `itemId` and `noRecord`
already use to survive a calendar refresh — omitted from the upsert's `set`
clause. A new `seriesId`, carried from EventKit's `calendarItemIdentifier` and
from the feed parser's existing `uid`, is what "decline the series" applies
to. The audit is a read-only view over the last 90 days, grouping by that same
series id, joining a new arbitrary-time-range activity query against the
meeting's own window.

**Tech Stack:** Swift (EventKit) for the calendar helper; Next.js 16 App
Router, React 19 (react-compiler lint: no synchronous `setState` in effect
bodies), Tailwind 4 Carbon tokens, Drizzle + better-sqlite3, zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-25-meetings-worth-being-in-design.md`

## Global Constraints

- Carbon tokens only — `src/test/tokens.test.ts` bans `ink`, `slate`, `brass`,
  `paper`, `tone=`, `on-paper`, `shadow-dock`. Sentence case. `focus-ring` on
  every interactive element. `aria-label` on icon-only controls.
- No synchronous `setState` in an effect body (react-compiler lint).
- Tests never touch the network, never depend on the real clock, and never
  depend on the machine's timezone. Every function needing the clock takes
  `now: Date` with a default. Four tests already fail under
  `TZ=Pacific/Midway` in `src/domain/activity/calendar.test.ts` and
  `src/lib/planner.test.ts`, both recorded pre-existing; do not add a fifth.
- **There is no Swift test suite in this repository.** The helper change in
  Task 1 is verified by careful reading, by the existing TS-side ingestion
  tests fed corrected fixture data, and by the implementer's own written
  reasoning about every `EKParticipantStatus` case — not by a Swift test.
  Say so plainly in the task report rather than claiming coverage that does
  not exist.
- **No button in this app ever sends anything to a calendar server.** §1.1 of
  the design. A decline recorded here is a local decision; the only outward
  action is a deep link to the system Calendar app, opened by the person's
  own click.
- **Nothing is ever auto-assigned that a person did not choose.** Container
  suggestions in Task 3 are offers, never writes.
- **No meeting score, no cost-in-currency figure, no speaker attribution.**
  §8 of the design names these as deliberately out of scope. Do not add them
  even if a task feels like it would benefit from one.
- Migrations: `npx drizzle-kit generate --name <name>`. Never hand-edit the
  journal or the snapshot.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`

---

## File structure

| File | Responsibility |
|---|---|
| `helper/activity/Sources/sb-activity/CalendarReader.swift` | read the real RSVP and the series identifier; drop cancelled events |
| `src/domain/activity/calendar.ts` (+ test) | ingest the corrected status and the new `seriesId` |
| `src/domain/activity/feed.ts` | carry the existing `uid` into `seriesId` for feed-sourced events |
| `src/db/enums.ts`, `src/db/schema.ts`, `drizzle/00NN_*.sql` | `MEETING_DECISIONS`, `calendar_events.seriesId`/`decision`/`decisionNote`, `meeting_series_decisions` |
| `src/domain/meetings/decision.ts` (+ test) | `effectiveDecision`, `setMeetingDecision`, series/occurrence resolution |
| `src/lib/capacity.ts` (+ test) | going/maybe/not-going arithmetic |
| `src/domain/meetings/auto-start.ts` (+ test) | honour the local decision, not only calendar status |
| `src/lib/dto.ts`, `src/lib/api.ts`, `src/lib/validation.ts` | `MeetingDecisionDTO`, serializers, request bodies |
| `src/app/api/meetings/[id]/decision/route.ts` (+ test) | the one mutating endpoint this plan adds |
| `src/components/planner/meeting-row.tsx`, `meetings-view.tsx` (+ tests) | the decision control, the calendar deep link, the filter |
| `src/domain/containers/suggest.ts` (+ test) | the dull, offer-only container match |
| `src/app/c/[slug]/page.tsx`, `src/components/container-editor.tsx` (+ tests) | a real meetings section, not the generic bucket |
| `src/domain/activity/report.ts` (+ test) | `activityBetween` — an arbitrary time range, not only a whole day |
| `src/domain/meetings/audit.ts` (+ test) | group by series, join activity, attendance, tasks |
| `src/app/meetings/audit/page.tsx`, `src/components/meeting/audit-view.tsx` (+ tests) | the view |
| `README.md` | one section |

---

### Task 1: The RSVP bug, fixed at the source

**Files:**
- Modify: `helper/activity/Sources/sb-activity/CalendarReader.swift`,
  `src/domain/activity/calendar.ts` (+ test), `src/domain/activity/feed.ts`
  (+ test)

**Interfaces:**
- Consumes: nothing new — this task changes what flows into the *existing*
  `calendar_events.status` column and adds one new field to the payload,
  `seriesId`.
- Produces:
  - The Swift `EventPayload` struct gains `seriesId: String?`.
  - `status` is now the current user's real RSVP, not the event's own
    confirmed/tentative/cancelled state.
  - A genuinely cancelled event is omitted from `upcoming()` entirely, so it
    falls out through the calendar sync's existing "drop what vanished"
    purge rather than needing new deletion logic.
  - TS: `CalendarEventInput.seriesId?: string`, threaded through
    `replaceCalendarEvents`.

- [ ] **Step 1: Write the failing TS-side test first**

Before touching Swift, pin the behaviour the fix is *for* — that the app's
existing `status !== "declined"` checks in `capacity.ts` and `home.ts`
correctly exclude a meeting once given the *right* data, with no changes
needed to those files:

```ts
it("excludes a meeting the person actually declined, once status carries their real RSVP", () => {
  const meetings = [{ startsAt: "2026-09-28T10:00:00", endsAt: "2026-09-28T10:30:00", allDay: false, status: "declined" }];
  expect(freeMinutes(meetings, "09:00-18:00", "2026-09-28")).toBe(540);
});
```

This test likely already exists somewhere in `capacity.test.ts` under the old
(accidentally-correct-for-the-wrong-reason) assumption — find it and read its
comment. If its comment says anything like "a declined meeting" without
distinguishing "the event was cancelled" from "the person declined," correct
the comment now, because that ambiguity is precisely the bug.

- [ ] **Step 2: Read every `EKParticipantStatus` case before writing the Swift**

`EKParticipantStatus` has: `.unknown`, `.pending`, `.accepted`, `.declined`,
`.tentative`, `.delegated`, `.completed`, `.inProcess`. Map:

```
.accepted  → "accepted"
.declined  → "declined"
.tentative → "tentative"
everything else → "none"
```

Find the current user's own attendee: `e.attendees?.first(where: { $0.isCurrentUser })`.
**Two edge cases to handle explicitly, in a comment, because there is no test
to prove them:**

1. An event with no attendees at all (a personal, unshared calendar entry) —
   `isCurrentUser` is never found, falls through to `"none"`. This is
   correct: there is no RSVP to have.
2. An event the person organises — some calendars omit the organiser from
   the attendee list entirely, others include them pre-accepted. Either way
   the fallback to `"none"` when no `isCurrentUser` attendee exists is the
   safe answer; do not special-case the organiser.

- [ ] **Step 3: Replace `statusName(EKEventStatus)` with the participant read**

```swift
private func rsvpStatus(_ event: EKEvent) -> String {
    guard let me = event.attendees?.first(where: { $0.isCurrentUser }) else { return "none" }
    switch me.participantStatus {
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    default: return "none"
    }
}
```

Keep `statusName`'s old body nowhere — do not leave it dead in the file for
someone to accidentally call again.

- [ ] **Step 4: Drop genuinely cancelled events from the payload**

In `upcoming()`, before mapping `e` into an `EventPayload`, skip when
`e.status == .canceled`. Comment why: the calendar's own "drop what vanished"
purge in `src/domain/activity/calendar.ts` already removes rows that stop
appearing in a sync window, so omitting a cancelled event here is sufficient
— no new deletion path is needed.

- [ ] **Step 5: Carry a series identifier**

Add `seriesId: e.calendarItemIdentifier` to the payload unconditionally —
EventKit gives every event, recurring or not, a `calendarItemIdentifier`, and
for a non-recurring event it is simply unique to that one event, which is a
harmless "series of one." Do not attempt to detect recurrence and set it
conditionally; the uniform behaviour is simpler and exactly as correct.

- [ ] **Step 6: TS ingestion — thread `seriesId` through, no other change**

`src/domain/activity/calendar.ts`'s `replaceCalendarEvents` gains `seriesId`
in `CalendarEventInput` and in the upsert's `set` values (it is calendar-owned
data like `title` — refreshed every sync, unlike `itemId`/`noRecord`). Read
the existing upsert exactly (`values` object, `onConflictDoUpdate`) before
touching it; match its shape.

- [ ] **Step 7: The feed parser already has a `uid` — use it as `seriesId`**

`src/domain/activity/feed.ts` embeds `ev.uid` into `externalId` as
`feed:{uid}` or `feed:{uid}:{recurrenceId}`. Extract `ev.uid` itself into the
new `seriesId` field on `CalendarEventInput` for feed-sourced rows, rather
than leaving series grouping possible only for eventkit-sourced ones. No
schema change needed here — this is a parsing change only.

- [ ] **Step 8: Run the suite**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus
`TZ=Pacific/Midway npm test` where the only failures are the four known
pre-existing ones.

- [ ] **Step 9: Rebuild the Swift helper — read, do not run, `scripts/brain.sh`**

Do not run `scripts/brain.sh restart` or `helpers` against the live checkout
yourself — that is production. Confirm the Swift compiles
(`swift build` inside `helper/activity` is safe; it does not touch the
running app) and report the exact commands the coordinator needs to run to
deploy (`scripts/brain.sh restart --build --helpers`, per the script's own
usage text — verify the flag name by reading `scripts/brain.sh`, do not
assume it).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "fix(meetings): read the person's own RSVP, not the event's confirmed state

<trailers>"
```

---

### Task 2: Your own answer, and what it costs

**Files:**
- Modify: `src/db/enums.ts`, `src/db/schema.ts` (+ generated migration),
  `src/lib/capacity.ts` (+ test), `src/lib/dto.ts`, `src/lib/api.ts`,
  `src/lib/validation.ts`, `src/domain/meetings/auto-start.ts` (+ test),
  `src/components/planner/meeting-row.tsx` (+ test),
  `src/components/planner/meetings-view.tsx` (+ test)
- Create: `src/domain/meetings/decision.ts`,
  `src/domain/meetings/decision.test.ts`,
  `src/app/api/meetings/[id]/decision/route.ts`,
  `src/app/api/meetings-decision.test.ts`

**Interfaces:**
- Consumes: `seriesId` from Task 1; `crossSite`, `forbidden`, `errorResponse`
  from `@/lib/api`.
- Produces:
  - `MEETING_DECISIONS = ["going", "not-going", "maybe"] as const` in
    `src/db/enums.ts`.
  - Schema:
    ```ts
    // On calendarEvents, added alongside the existing columns. `seriesId` is
    // this task's to add as a real column — Task 1 deliberately threaded it
    // through CalendarEventInput and the API route's validation with no
    // schema column, so this is the first place it is persisted. Unlike
    // decision/decisionNote (person-owned, excluded from the upsert's set
    // the way itemId/noRecord already are), seriesId is calendar-owned data
    // and belongs INSIDE the refreshed set, refreshed every sync like title.
    seriesId: text("series_id"),
    decision: text("decision", { enum: MEETING_DECISIONS }),        // per-occurrence override, null = defer
    decisionNote: text("decision_note").notNull().default(""),

    export const meetingSeriesDecisions = sqliteTable(
      "meeting_series_decisions",
      {
        seriesId: text("series_id").primaryKey(),
        decision: text("decision", { enum: MEETING_DECISIONS }).notNull(),
        note: text("note").notNull().default(""),
        decidedAt: text("decided_at").notNull(),
      },
    );
    ```
  - `src/domain/meetings/decision.ts`:
    - `effectiveDecision(event: { status: MeetingStatus; decision: MeetingDecision | null }, seriesDecision: MeetingDecision | null): MeetingDecision` —
      pure. Order: the occurrence's own `decision` if set, else
      `seriesDecision` if one exists for its `seriesId`, else derive from
      `status` (`declined` → `"not-going"`, everything else → `"going"`).
      **Calendar `"tentative"` does not auto-derive to `"maybe"`** — `maybe`
      is a decision the person makes in this app, never inferred, because it
      carries its own capacity arithmetic and an inferred half-commitment is
      a guess dressed as a fact.
    - `setMeetingDecision(db, eventId, { decision, note, scope: "occurrence" | "series" }): void` —
      writing `scope: "series"` requires the event to have a non-null
      `seriesId`; writing without one throws `MeetingError(…, 400)`.
    - `seriesDecisionsFor(db, seriesIds: number[]): Map<string, MeetingDecision>` —
      one grouped query for a list, following the batching pattern
      `focusMinutesByTask` and `goalRefsByContainer` already established; a
      per-row lookup here would be the fourth review finding of this exact
      shape in this repository.
  - `src/lib/capacity.ts`: `CapacityMeeting` gains `decision` (the
    *effective* decision, already resolved — capacity code should not need
    to know about series). `freeMinutes` changes its filter/reduce:
    `not-going` meetings contribute 0 minutes (excluded, as `declined`
    already was); `maybe` meetings contribute **half** their clipped
    duration; `going` meetings contribute their full clipped duration exactly
    as before. Write this as a small pure helper,
    `meetingCost(m: CapacityMeeting): number`, testable on its own before
    wiring it into the merge/reduce loop.
  - `src/domain/meetings/auto-start.ts`: the `continue` guard at line 68
    (`ev.allDay || ev.noRecord || ev.status === "declined"`) becomes
    `ev.allDay || ev.noRecord || effectiveDecision(ev, seriesDecision) !== "going"`.
    A `"maybe"` meeting is not auto-recorded — auto-record only fires for a
    clear yes, per the design's "Maybe: counts as half against capacity;
    still recordable" (recordable by hand, not automatically).
  - DTO: `MeetingDecisionDTO { decision: MeetingDecision; note: string; scope: "occurrence" | "series" }`
    surfaced on whatever DTO the meetings view already reads (find it —
    likely `ActivityMeetingDTO` in `src/lib/dto.ts`; do not invent a second
    meeting DTO).
  - Route: `PATCH /api/meetings/[id]/decision`, body
    `{ decision, note?, scope }`, gated on `crossSite`, parsed with
    `Schema.parse(await req.json().catch(() => null))`.

- [ ] **Step 1: Write the failing domain test**

`src/domain/meetings/decision.test.ts`, `makeTestDb()` /
`afterEach(cleanup)`:

```ts
it("an occurrence override wins over a series decision", () => {});
it("a series decision applies when no occurrence override exists", () => {});
it("falls back to the calendar's own status when neither is set", () => {});
it("never infers maybe from a tentative calendar status", () => {
  expect(effectiveDecision({ status: "tentative", decision: null }, null)).toBe("going");
});
it("refuses a series-scoped decision on an event with no seriesId", () => {});
it("one query resolves series decisions for a list of ids, not one per id", () => {
  // spy on db.prepare / the query builder, assert exactly one call for ten ids
});
```

- [ ] **Step 2: Run to verify it fails, then write the module and the migration**

`npx drizzle-kit generate --name meeting-decisions`. Commit the generated SQL,
journal and snapshot exactly as generated.

- [ ] **Step 3: `meetingCost` and the capacity wiring, with its own failing test first**

```ts
it("a not-going meeting costs nothing", () => {});
it("a maybe meeting costs half its clipped duration", () => {});
it("a going meeting costs its full clipped duration, as before", () => {});
it("half-minutes round the way the rest of capacity.ts does (check the existing rounding convention before choosing one)", () => {});
```

Read how `freeMinutes` currently merges overlapping meetings before touching
it — the merge-then-subtract logic must still be correct when some meetings
in the overlap are `maybe` and others are `going`; do not simply sum
independent costs if the existing code already merges overlapping spans
first (it does — read it).

- [ ] **Step 4: Auto-start's guard, with its own failing test**

```ts
it("does not auto-record a meeting marked maybe", () => {});
it("does not auto-record a meeting whose series was declined, even with no per-occurrence override", () => {});
```

- [ ] **Step 5: The route**

Copy the shape of an existing single-purpose mutating route in this repo
(`src/app/api/meetings/recorder/*` is the closest neighbour — read it for the
`crossSite` and error-response idiom). Test the malformed-body case,
the missing-`seriesId`-for-series-scope 400, and the origin guard actually
refusing a write (assert nothing changed, not only the status code — a
prior review in this repository found exactly this gap and it should not
recur).

- [ ] **Step 6: The row control**

On `meeting-row.tsx`, beside the existing "Don't record" Chip: a small
control offering Going / Maybe / Not going, and — only when the effective
decision is `"not-going"` — one line: *"This is your record, not a reply.
Open in Calendar to tell the organiser."* with a button. For the Calendar
deep link, research the correct approach before writing it: macOS Calendar
supports opening a specific event via an `ical://` or `x-apple-calevent://`
URL scheme in recent macOS versions — verify the exact scheme and required
identifier format works on this machine's macOS version before committing
to it, and if no reliable scheme exists, fall back to opening the Calendar
app itself (`open -a Calendar`) rather than shipping a link that silently
does nothing. Say in the report which you used and why.

When choosing "Not going" (or "Maybe") and the event has a `seriesId`, ask
once — "Just this one, or every time this meeting happens?" — before
writing. When it does not (a one-off meeting), write the occurrence decision
directly with no question.

A meeting with an effective decision of `"not-going"` is styled distinctly
but never hidden from this row-level view — hiding is the filter's job
(Step 7), not the row's.

- [ ] **Step 7: The filter**

`meetings-view.tsx` gains a toggle: everything, or only what is not going.
Declined meetings stay in the record permanently — this filter hides them
from the default view, it never deletes or archives anything. Re-accepting
(setting the decision back to `"going"`) is one click from the same row.

- [ ] **Step 8: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus the `TZ` run.

```bash
git commit -m "feat(meetings): a decision that survives the sync, and what maybe actually costs

<trailers>"
```

---

### Task 3: A meeting belongs somewhere

**Files:**
- Create: `src/domain/containers/suggest.ts`, `src/domain/containers/suggest.test.ts`
- Modify: `src/components/container-editor.tsx` (+ test),
  `src/app/c/[slug]/page.tsx` (+ test),
  `src/components/planner/meetings-view.tsx` (+ test)

**Interfaces:**
- Consumes: `listContainers` from `@/domain/containers`; the same
  "dull matching" philosophy the forecast slice's estimate hint already
  established — same container signal, shared-word matching, never
  cleverness.
- Produces: `suggestContainer(db, meeting: { title: string; attendeeNames: string[] }): ContainerRef | null`.

- [ ] **Step 1: The suggestion — dull on purpose, with a failing test first**

```ts
it("suggests a project whose name shares a real word with the meeting title", () => {});
it("suggests a project one of whose people matches an attendee name", () => {});
it("suggests nothing when no signal reaches the threshold, rather than guessing", () => {});
it("never returns a resource — only a project or an area, matching design §6", () => {});
```

Matching is deliberately dull: a shared word of four or more letters after
lowercasing between the meeting title and a project/area name, or an
attendee name matching a person already linked to that container. Batch it —
one query for the list of active containers and their people, not one per
meeting, for the same reason every other list-cost finding in this
repository has already been raised three times.

- [ ] **Step 2: The offer, never the write**

The suggestion renders as a chip on an uncontainered meeting row:
"Looks like *Q3 platform*?" with an accept and a dismiss. Accepting calls the
existing `PATCH /api/items/[id]` with `containerId` — the container-assignment
path already works for meeting items (confirmed: no meeting-specific gating
anywhere in that path). This task adds no new write path, only the offer UI
and the dismiss state (session-local, does not persist — a dismissed
suggestion may reappear on reload; note this rather than build a dismissal
table for it, which is more machinery than the feature needs).

- [ ] **Step 3: A real meetings section on the project page**

`ContainerEditor` currently lumps meeting items into a generic "Files and
other items" bucket alongside links and everything else that is not a task
or a note. Give meetings their own section — same list style as the notes
section, each row showing the meeting's date, title, and its existing
Notes/Transcript/Summary badges (reuse whatever renders those badges on
`meeting-row.tsx`; do not write a second badge renderer).

- [ ] **Step 4: Filter the meetings view by project**

A project-scoped meetings view: either a query param on the existing
`meetings-view.tsx` or a dedicated route — match whichever pattern the
Planner's existing views already use for "day" vs "week" vs "meetings" tabs
rather than inventing a new one.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git commit -m "feat(meetings): a meeting belongs somewhere, offered, never assigned

<trailers>"
```

---

### Task 4: The audit

**Files:**
- Modify: `src/domain/activity/report.ts` (+ test)
- Create: `src/domain/meetings/audit.ts`, `src/domain/meetings/audit.test.ts`,
  `src/app/meetings/audit/page.tsx`, `src/components/meeting/audit-view.tsx`
  (+ test), `src/app/api/meetings/audit/route.ts` (if the page needs a
  client-refreshable payload; if it can be server-rendered whole, skip the
  route and say so in the report)

**Interfaces:**
- Consumes: `seriesDecisionsFor`, `effectiveDecision` from Task 2;
  `suggestContainer` is not needed here. `hasUserNotes` from
  `src/lib/planner.ts`. `getWorkingDays` from `@/lib/work-hours`.
- Produces:
  - `activityBetween(db, from: string, to: string): DaySession[]` in
    `src/domain/activity/report.ts` — an arbitrary UTC instant range, not a
    whole local day. `getDay`/`clippedSessions` only accept a whole day
    today; write this as a sibling, reusing the same
    `and(lt(startedAt, end), gt(endedAt, start))` overlap pattern already
    used elsewhere in that file, not a copy of `clippedSessions` with a
    different day boundary.
  - `src/domain/meetings/audit.ts`:
    - `interface SeriesAudit { seriesId: string | null; title: string; occurrences: number; totalMinutes: number; attendedCount: number; lastNoteAt: string | null; hasTranscript: boolean; tasksSince: number; topActivity: { label: string; ms: number }[] }`
    - `auditSeries(db, { since: string; now?: Date }): SeriesAudit[]` — groups
      the last 90 days of `calendar_events` by `seriesId` (a null `seriesId`
      — should not occur post-Task-1, since every event now gets one, but
      guard it anyway — groups as its own singleton). One query for the
      window's events, one grouped query for their series decisions, one
      grouped query for tasks whose `sourceItemId` lands on any of the
      window's captured meeting items (confirmed wired end-to-end already —
      reuse `listTasks(db, { sourceItemId })`'s underlying query pattern
      batched, not called once per series). Sorted by `totalMinutes`
      descending, per design §7.
    - `weeklyMeetingShare(db, week: string): { minutes: number; workingMinutes: number }` —
      this week's meeting minutes (effective decision `going` or `maybe`,
      halved for `maybe`, reusing `meetingCost` from Task 2) against the
      working week the planner already computes.

- [ ] **Step 1: `activityBetween`, with a failing test first**

```ts
it("returns sessions overlapping an arbitrary instant range, not bounded to one local day", () => {});
it("clips a session that starts before the range to the range's own start", () => {});
it("clips a session that ends after the range to the range's own end", () => {
  // A meeting audit's window must not attribute time outside the meeting to it.
});
```

- [ ] **Step 2: `auditSeries`, with a failing test first**

```ts
it("groups occurrences by seriesId across the whole window", () => {});
it("computes attendance as the share whose effective decision was going or maybe", () => {});
it("orders by total minutes, the recurring cost first, not the rare long workshop", () => {});
it("costs one query per input list, not one per series — the pattern this repo has enforced three times already", () => {});
it("names what activity ran during the series' occurrences, using activityBetween per occurrence's own window, merged", () => {});
```

- [ ] **Step 3: The view**

One page. A line at the top: this week's meeting share of the working week,
in the same wording style the planner's capacity line uses ("X h in
meetings, about Y% of the working week"). Then rows, ordered by total
minutes, each showing the evidence sentence design §3 specifies almost
verbatim — occurrence count, total hours, attendance, note/transcript
presence, and (if any) tasks created from it — with one control: Not going,
for the next occurrence or the series. No score, no colour ranking, no
"health" label anywhere on this page — design §7 is explicit that the value
is in the person asking the five questions, not in software answering them.

- [ ] **Step 4: README and commit**

A short Meetings section: what the local decision means and that it never
sends anything anywhere, what "maybe" costs, that a meeting can belong to a
project, and what the audit shows and does not show (no score, no cost
estimate). Match the voice of the other sections.

Run: `npm test && npx tsc --noEmit && npm run lint`, plus the `TZ` run.

```bash
git commit -m "feat(meetings): the audit — what a recurring meeting has actually cost

<trailers>"
```
