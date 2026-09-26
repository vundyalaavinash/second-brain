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
correctly authoritative in `capacity.ts` and, after this fix round, in the
scheduler's busy-span calculation (`src/domain/blocks/index.ts`). It is still
read as raw calendar `status` in four other places: `src/lib/review.ts:22`,
`src/lib/home.ts:58` and `:200`, and `src/components/planner/planner-shell.tsx:192`
and `:206`.

None of these has the scheduler's functional consequence -- they are counts
and summaries, not placement decisions, so nothing is silently misplaced. But
left as-is they can disagree with each other: the weekly review counting a
meeting the day view has already excluded, say. Worth one focused pass that
migrates all four together, rather than fixing three now and two later, which
would only trade one inconsistency for another.
