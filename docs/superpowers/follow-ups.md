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
