# Follow-ups

Things worth doing that were deliberately left out of the branch that found
them, each with the reason. Recorded here rather than in an SDD ledger because
the ledgers are git-ignored scratch and these outlive their slice.

## Two test files fail under a westward timezone

`src/domain/activity/calendar.test.ts` (3 tests) and `src/lib/planner.test.ts`
(1 test) fail under `TZ=Pacific/Midway`. Confirmed pre-existing: they fail
identically on the commits before the goals, focus and weekly-review slices,
and none of those branches touched either file or the code beneath it.

Everything written since is timezone-clean — `src/lib/week.ts` was swept over
every day from 2023 to 2028 across nine zones without bending — so this is the
last of the old fixtures built from UTC strings where the code reads local days.
The fix is the same one the newer suites use: build the fixtures from local date
components.

## The activity barrel re-exports `localDay`

`localDay` moved to `src/lib/time.ts` during the goals slice, so a client
component and the domain could share one implementation. `src/domain/activity/calendar.ts`
imports and re-exports it, which keeps all fourteen existing import sites
working — verified by runtime identity, all three paths hand back the same
function object.

The tidy is to move the nine `@/domain/activity` importers onto `@/lib/time`
and drop the re-export, so the activity barrel stops advertising a helper that
has nothing to do with activity. Nine files, no behaviour change, which is why
it was not done at merge time.

## `complete-project-dialog.tsx` has weaker keyboard behaviour than its neighbours

`src/components/use-dialog.ts` gives the goals dialogs `role="dialog"`,
`aria-modal`, Escape, a focus trap and focus return. `complete-project-dialog.tsx`
predates it and has none of them, and it was the file the goals dialogs were
originally told to copy. The repo's other overlays — the rules drawer, the
container and people pickers, the plan picker, the command palette, the inbox
processor — all handle Escape, so this one is the outlier rather than the norm.

Moving it onto `useDialog` is a small change that was out of scope for a slice
about goals.

## `DateString` accepts dates that do not exist

`src/lib/validation.ts`'s `DateString` is a regex, so `2026-13-45` passes and
`Date` rolls it over to February 2027. The weekly-review slice added
`CalendarDateString` and applied it to the three review routes and the review
page, because those key a permanent record on that value.

Every other route still takes the regex-only version. Worth a sweep, with an eye
on which of them can create something durable from a bad date.

## "Plan for Monday" plans only into Monday

Design §5.1 says the weekly review's plan control "drops chosen tasks onto next
week's days". It lands everything on next Monday, and the control now says so
rather than promising more. Spreading across the week — by due date, or by where
there is capacity — is a real feature and wants its own thinking, probably
reusing the scheduler that already fills a day.

## The review's snapshot re-freezes a live project name

Re-saving a past week's review rebuilds the frozen snapshot from the current
payload, so a container renamed since is written into the frozen record under
its new name. Harmless today: the render path prefers the live row wherever the
container still exists, and the frozen name is only ever a fallback for one that
was deleted. Recorded so it is a known consequence rather than a surprise.

## The planner scrolls sideways below about 500px

Confirmed pre-existing, not introduced by the forecast work: the same overflow
appears on `master` at 420px. The date header's "Today" control, the plan pane's
right edge, the add-a-task field and the calendar setup card are all clipped, and
the document's scroll width exceeds the viewport.

The capacity line itself wraps correctly, so the cause is elsewhere in the day
view or the shell. It does not affect use on a laptop at full width, which is why
it was recorded rather than chased mid-slice. Worth a pass of its own, measuring
which element actually forces the width rather than guessing.

A lead, from the Task 2 review: `src/components/planner/calendar-feed.tsx`'s
`min-w-[240px]` is the most likely culprit. Measure before believing it — the
point of this note is that the element was guessed at rather than found.

## The audio footprint line does not say how stale it is

`safetyStatus` reads a persisted snapshot of how much recorded audio is held,
refreshed by the nightly job, by "Remove the audio", and by the manual
`release-audio` command -- never when a recording finishes on its own. So the
figure can lag by up to one nightly cycle, and the line renders it in the
present tense ("No audio held.") with nothing saying as of when.

`recordAudioFootprint` already stores `computedAt` for exactly this reason --
the field exists, documented as "the status line does not currently show
this, but the shape is here so it could without another format change." It is
dropped by `readAudioFootprintSnapshot` and absent from `AudioFootprintDTO`.

Not fixed now because the staleness window is bounded and the current wording
is not actually false -- a freshly upgraded install correctly shows zero until
the first nightly run touches it, which is the same "silence is not evidence
of a problem" reading the rest of the safety design already gives an unset
value. Worth doing when the status line next changes shape: surface
`computedAt` in the DTO and word the line as "as of last night" rather than
letting the present tense imply something it does not measure live.

## The feed source has the same RSVP bug the EventKit side just fixed, and it may not be fully fixable

`src/domain/activity/feed.ts`'s `statusOf` reads `X-MICROSOFT-CDO-BUSYSTATUS` --
whether the *block on the calendar* is busy, tentative or free -- and maps
that onto `MeetingStatus`. It can never produce `"declined"` at all: a
meeting the person declined in Outlook, synced through a published ICS feed,
shows as `"accepted"` if Outlook still marks the block busy, or `"none"`
otherwise -- and `"none" !== "declined"`, so it still counts against
capacity, still appears in the day, and would still be eligible for
auto-recording.

Checked before writing this: no calendar feed URL is configured on this
machine right now, so the bug is currently dormant rather than live. It
matters the moment a feed is set up, which was the whole point of the
calendar-feed work from an earlier session -- Outlook's own EventKit access
only ever saw a holidays calendar, and a published feed was the workaround.

**Why this is not a small fix like the EventKit side was.** Two real
obstacles, not just more code:

1. A calendar published via "Publish a Calendar to Web" (the feature behind
   a webcal/ICS subscription link) generally does not include `ATTENDEE`
   lines with `PARTSTAT` at all, at any of Outlook's detail levels --
   attendee and RSVP data is treated as more sensitive than busy/free and
   free-text details, and is typically stripped before publishing. This is
   a property of the data Outlook actually publishes, not something this
   app's parser is failing to read. It needs confirming against a real
   feed once one exists, but should not be assumed fixable by more careful
   `ical.js` reads alone.
2. Even if `PARTSTAT` were present, there is no concept anywhere in this app
   of "which attendee is me" -- no stored email or identity setting exists
   to match against an `ATTENDEE` line. EventKit's fix could ask for
   `isCurrentUser` because the local Calendar app already knows which
   account is the person's own; a bare subscribed feed has no equivalent.
   Building this properly means adding a real identity setting first, not
   only a parser change.

**The practical mitigation already exists, elsewhere in this same slice.**
Task 2 of `docs/superpowers/plans/2026-09-26-meetings-worth-being-in.md`
adds a local decision (going / not-going / maybe) that is independent of
whatever the calendar says and survives every refresh -- exactly because
the calendar, and especially a read-only feed, may simply not carry a
reliable RSVP. Once that ships, a feed-sourced meeting the person wants to
skip can be marked "not going" by hand, correctly excluded from capacity
and auto-recording, with no dependency on `PARTSTAT` ever arriving. That
does not fix `statusOf`'s misreading, but it removes most of the practical
cost of leaving it unfixed for now.

Worth revisiting once: (a) a feed is actually configured, so the real ICS
can be inspected rather than guessed about, and (b) if the app ever gains a
stored identity setting for another reason, which would make the fix
genuinely possible rather than merely plausible.

## The local meeting decision is not authoritative everywhere yet

Task 2's review found the new local decision (going/maybe/not-going) is
correctly authoritative in `capacity.ts` and, after that fix round, in the
scheduler's busy-span calculation (`src/domain/blocks/index.ts`). The final
whole-branch review found two more sites that had quietly regressed to raw
calendar `status` and did carry a real functional consequence -- Home's
"Now and next" (`src/lib/home.ts`'s `timedItems`) could show a declined
meeting as happening now, hiding the task the scheduler correctly placed in
that freed hour, and the Planner day timeline (`src/components/planner/timeline.tsx`)
rendered a declined meeting in the timed column and widened the hour range to
fit it, contradicting the capacity line one component above it. Both are
fixed as of this round, reading the batched effective decision the same way
`capacity.ts` and `busySpans` already do.

Four places still read raw calendar `status` instead of the effective
decision: `src/lib/review.ts:22` (`isCountableMeeting`), `src/lib/home.ts:209`
(the `counts.meetings` figure -- distinct from `timedItems`, now fixed, in the
same file), and `src/components/planner/planner-shell.tsx:192` and `:206` (the
day and week capacity-line meeting counts).

None of these four has the scheduler's or the timeline's functional
consequence -- they are counts and summaries, not placement or rendering
decisions, so nothing is silently misplaced or hidden. But left as-is they can
disagree with each other: the weekly review counting a meeting the day view
has already excluded, say. Worth one focused pass that migrates all four
together, rather than fixing some now and the rest later, which would only
trade one inconsistency for another.

## `seriesId` backfill gap: older rows read as one-off meetings for a while after deploy

Task 1's helper only threads `seriesId` through the fixed -30/+60 day sync
window it has always covered. A row already in the database from before this
deploy, outside that window but still inside the audit's 90-day (or shorter,
per retention) lookback, keeps whatever `seriesId` it already had -- `null`,
since the column did not exist until Task 2's migration.

The practical effect is on `/meetings/audit`: those older rows group as their
own one-off "series" (`auditSeries` keys a null `seriesId` on the event's own
id) rather than joining the recurring series they actually belong to, so a
recurring meeting can show as several separate single-occurrence rows for a
while. This is self-healing, not a standing bug: a row already outside the
helper's -30/+60 day sync window at deploy time never gets re-synced (that is
exactly what makes it "outside the window"), so it keeps its null `seriesId`
for the rest of its life -- the gap closes only as those rows age past the
audit's 90-day (or shorter, per retention) lookback and drop out of the view
entirely. Rough estimate: fully gone about 60 days after this deploys, since
that is the outer edge of the affected set at deploy time.

Not fixed now because a real fix means re-deriving series membership from
event content (title, organizer, recurrence pattern) for old EventKit-sourced
rows, since EventKit's own external id for an occurrence carries no series
information on its own -- genuinely harder than a backfill script. (A partial
backfill is mechanically possible for feed-sourced rows, whose external id is
`feed:{uid}[:{recurrenceId}]` and so already contains its own series id --
moot today since no calendar feed is configured on this machine, but worth
remembering if one ever is, rather than assuming backfill is impossible for
every source.)

## `decisionNote` has no UI anywhere

The column is fully plumbed end-to-end: it exists on `calendarEvents`
(migration), survives a calendar refresh instead of being overwritten
(`replaceCalendarEvents`'s sync-preservation), is written by
`setMeetingDecision` (both occurrence- and series-scoped, `PATCH
/api/meetings/[id]/decision` already accepts an optional `note`), and is
carried on `ActivityMeetingDTO`/`MeetingListDTO` as `decisionNote`. Nothing in
the app writes or displays it: no text field on `meeting-row.tsx`'s decision
control or its "just this one or every time" question, nowhere it is rendered
to read back.

This is design §4's "optional line of why" for a decision -- the reasoning
behind a Not going or Maybe, kept apart from the calendar itself. Four tasks
and a whole-branch review built every pipe it needs; none built the faucet.
Deferred deliberately rather than scope-crept into this fix round: it needs
real UI thinking (where does the field go on the row, when does it show, does
it need its own affordance versus living inline with the decision chips) that
is a small new feature in its own right, not a bug fix.

## A reversed series decision can retroactively change what the audit says about the period it covered

Making a series decision reversible (the whole-branch review's F2) is
unambiguously the right fix -- before it, declining a whole series was a dead
end nobody could undo without individually re-accepting every future
occurrence. But `meetingSeriesDecisions` stores exactly one row per series,
with one `decidedAt`, and a reversal overwrites that row rather than adding a
new one (`setMeetingDecision`'s `onConflictDoUpdate` on `seriesId`). The
`effectiveDecisionAsOf` uses that single `decidedAt` as the boundary between
"this occurrence is old enough to keep its own history" and "this occurrence is
governed by the current series decision." (It was the audit's own private helper
when this was written; the final whole-branch review's F-B promoted it to
`decision.ts` and put every backward-looking reader on it, so the consequence
below now reaches the Activity day report and the Meetings view as well as the
audit's attendance figure -- the same one boundary, read by more surfaces.)

Concretely: decline a weekly series in October, then re-accept it in
December. The October-to-December occurrences you genuinely skipped now have
a `startsAt` before the *updated* `decidedAt`, so `effectiveDecisionAsOf`
falls through to each occurrence's own calendar status rather than the
declined history -- and since nothing wrote a per-occurrence override during
the decline (a series-scoped write clears the issuing occurrence's own
override, and no other occurrence ever had one), those occurrences default
back to "going" and get counted as attended in the audit's "N of M attended"
figure, when they were not.

Narrow: it only surfaces after a decline-then-reverse cycle on the same
series, and any occurrence that separately picked up its own override during
the declined period is unaffected (its override still wins). Not fixed now
because the real fix is keeping history on `meetingSeriesDecisions` -- one row
per decision made, not one row per series -- which is a schema change well
outside a fix round, not a one-line correction.

## The meeting audit never says which project a series is filed to

Design §6 lists three things that follow from a meeting belonging to a
container, and the third is "the audit can say that a series belongs to a
project that closed in July". The first two shipped -- a project page lists its
meetings, the meetings view filters to one project -- and the third was never
built. It was not a considered omission either: nothing in any task brief
dropped it, which is what made it a whole-branch-review finding rather than a
known gap.

The point of the sentence is that a series' own worth is partly a question about
what it is still for. A weekly sync filed to a project that closed two months
ago is exactly the recurring hour §7's five questions exist to surface, and the
audit currently reports its minutes, its attendance and its output without ever
mentioning the one fact that would settle it.

Nothing new has to be plumbed for it. `auditSeries` already calls
`meetingItemFlags` on every occurrence's captured item, and that already returns
`containerId` alongside the `hasNotes`/`hasTranscript` flags the audit does read
-- the value is loaded and thrown away. Naming the container means one more
grouped query over the distinct ids (the `inArray` shape every other batched read
in that function already uses), a field on `SeriesAudit`, and somewhere on the
row to put it. The container's own status is already on the row that query would
return, so "closed in July" needs no extra read either.

Left out because it is a display enhancement, not a correctness bug: no figure
the audit currently reports is wrong without it. The fix round that found it was
already closing three real defects across decision coherence, the scheduler and
the retention purge, and this slice had four tasks and two review rounds behind
it -- adding a new field and a new piece of row UI at that point is scope, not
finishing. Recorded explicitly as a §6 deviation rather than quietly dropped,
which is the whole reason it surfaced.

## Two small scheduler/capacity disagreements a `maybe` meeting can still cause

F-D's fix (the second final whole-branch review) made `busySpans` charge a
`maybe` meeting half its duration, matching `freeMinutes`, and closed the two
disagreements that motivated it: a standalone `maybe` hour and two adjacent
`maybe` hours now agree exactly between capacity and the scheduler. Measuring
by hand across every shape of overlap turned up two narrower ones that were
never the fix's target and remain, both bounded and self-correcting:

A `maybe` meeting that only partly overlaps a `going` one can let the
scheduler place up to the non-overlapping tail's length more than capacity
reports free, because `busySpans` takes its half-span from the *start* of the
`maybe` meeting (falling inside the `going` one) while `freeMinutes` charges
the tail through `outsideCover`. And a `maybe` meeting that runs past the end
of the working day can make the scheduler under-place by up to the after-hours
portion, because `busySpans` costs the meeting's whole span before `freeSlots`
clips it to working hours -- this second case is pre-existing (it applies to
`going` meetings too) and not something F-D introduced.

Neither is a data-safety or correctness issue -- nothing is lost, nothing is
double-booked, and both self-correct as soon as the calendar or the day
changes. Left for a future pass rather than folded into F-D's fix, which
already closed the two disagreements that were actually reachable in the
common case (a `maybe` meeting on its own, or fully inside another meeting).

## `effectiveDecisionAsOf`'s time comparison is a raw string compare, not a real instant compare

`effectiveDecisionAsOf` (and the `startsAt <= decidedAt` check inside
`setMeetingDecision`) compares two ISO timestamp strings lexically rather than
parsing them first. This is correct today only because every writer that
produces a `startsAt` emits a UTC `Z` instant -- the Swift EventKit helper's
`ISO8601DateFormatter` and the ICS-feed ingestion's `.toISOString()` -- so a
lexical compare and a real instant compare agree. But the API route that
accepts a calendar sync payload validates `startsAt` only as "some string
`Date.parse` can read" (`z.string().refine(...)`), which also accepts an
offset-less local timestamp or one with an explicit `+HH:MM` offset. In a
positive-UTC-offset timezone, an offset-less local `startsAt` string can
compare *greater* than an equivalent UTC `decidedAt`, silently flipping which
side of the `decidedAt` boundary an occurrence falls on -- confirmed live
during the second final whole-branch review, on this machine's own timezone,
using exactly such a fixture.

Nothing in this app's own two writers can produce that shape today, so this is
latent rather than reachable in practice, and several existing test fixtures
already use the offset-less form -- meaning a test can pass while asserting
the opposite of what production would do in a positive-offset zone, the same
blind spot this slice has now found twice elsewhere. Fix shape for whoever
picks this up: normalize `startsAt` to a UTC instant on ingest, or compare via
`Date.parse(a) <= Date.parse(b)` rather than the raw strings, at both call
sites. Left as a follow-up rather than fixed alongside F-B/priority-2 because
it is not the thing that regressed -- it predates this slice's own review
rounds and was reviewed (unnoticed) at least twice already.
