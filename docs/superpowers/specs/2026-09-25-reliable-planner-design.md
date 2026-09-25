# The Planner That Keeps Its Word

**Date:** 2026-09-25
**Status:** approved

## 1. What is wrong with the planner today

I read the planner's own code before designing anything. It is well built and it
is honest about what it holds. The problem is that it holds and does not think.

Open it right now and it says: `0 planned · 0m of 9h free · 0 meetings`. Every
figure there is something you already knew. Open the week and you get seven
identical cards saying "Nothing yet". There is nowhere in the planner that tells
you something you did not already know, and nowhere that would stop you making a
mistake.

Five specific things, each verified in the code:

**It does not know what time it is.** `freeMinutes` is the working window minus
meetings. At four in the afternoon on a nine-to-six day it still reports nine
hours free. The scheduler knows about "now" when it places work; the figure you
read never does.

**It counts Saturday as a nine-hour working day.** The week view offers 63 hours
a week. A planner that overstates your week by two working days is not a planner.

**It cannot see a deadline coming.** A task due Friday with no time booked looks
exactly like one fully scheduled. Nothing anywhere compares "when is this due"
against "is any time set aside for it" until the day it is due.

**It has never once compared what you guessed to what it cost.** Focus runs have
been recording real minutes against tasks since the focus slice shipped. The only
place that data is used is one line on one task offering to correct one estimate.
Nothing aggregates it. The app is sitting on the exact evidence that would make
its forecasts honest and it does not look at it.

**It cannot tell you who is waiting.** A task cannot be linked to a person at
all. `item_people` links people to notes, never to work. The meetings view
records an "Actions" heading as free text nobody parses. So the app knows you had
a meeting, knows what was said, and does not know what you promised.

## 2. What the research says

**The planning fallacy is not fixed by knowing about it.** This is the finding
that shapes the whole design. In the canonical study, participants were warned
about the planning fallacy before estimating, and missed their deadlines at the
same rate as the unwarned group. Around 70% of people miss their own
self-predicted deadlines. Telling someone "be realistic" does nothing.

**What does work is the outside view.** Reference class forecasting: instead of
imagining how this task will go, look at the distribution of how similar past
tasks actually went, and adjust. Where both are applied with equal skill, the
outside view wins. The barrier for individuals has always been that nobody has
their own historical data. This app does — every focus run is a data point
pairing a guess against a measurement.

**Overcommitment has to be visible before it is a crisis.** The workload writing
is unanimous: the value is seeing that Tuesday holds nine hours of work in an
eight-hour day *while you are planning Tuesday*, so it is a decision rather than
a scramble at six o'clock.

**Reliability, to other people, is a small and specific set of behaviours.** Do
not overpromise. Follow through on what you said. Surface a problem early rather
than on the due date. Be the person who can say what they owe without checking.
None of that is about working harder; all of it is about knowing.

**Commitments must leave the meeting as commitments.** The action-item writing
converges on one rule: the conversion from "said in a meeting" to "tracked
somewhere" has to happen before everyone walks to the next thing. This app
already records, transcribes and summarises its own meetings, so it is the rare
case where the raw material is already in the building.

Sources in §9.

## 3. What this builds

Three parts, aimed squarely at the three words in the brief — smarter, reliable,
recognised.

- **The honest forecast** makes the planner stop lying about time. It knows what
  time it is, which days you work, and how long your work has actually taken you
  before.
- **Commitments** give work an owner outside yourself: who is waiting, what you
  said, and whether you have moved the date.
- **The watch** makes sure nothing slips quietly: what is due without time set
  aside, what you have carried four times, what you promised and have not planned.

## 4. The honest forecast

### 4.1 Drift: your own multiplier

For every task that is done and has at least one focus run, the app has a pair:
what you estimated, and what it actually took. **Drift** is the median of
`actual ÷ estimate` across the most recent 30 such tasks.

The median, not the mean, because one task that ran six times over should not
swing the number. Thirty, because it is enough to be stable and recent enough to
follow you as you change.

**With fewer than 8 pairs the app does not have a drift figure and says so.**
It shows estimates as estimates and a line reading "Not enough finished work yet
to know how your estimates run." Inventing a multiplier from three data points
would be exactly the false confidence this feature exists to remove.

Drift is clamped to the range 0.5–4.0, because outside that the number is a bug
in the data rather than a fact about the person.

### 4.2 What the planner says instead

The capacity line stops reporting arithmetic and starts reporting a forecast:

> 4h 30m planned · about 7h 20m at your pace · 5h 10m left today

Three figures, in that order, and the middle one is the point. "At your pace" is
`planned × drift`. When the forecast exceeds what is left, the line says so in
words: **"About 2h more than today holds."** No colour alarm; the sentence is the
alarm.

When there is no drift figure yet the middle number is simply absent.

### 4.3 It knows what time it is

`freeMinutes` gains a `now`. On today, the working window starts at the later of
the work-hours start and the current time. Looking at a past day it is zero.
Looking at a future day it is the whole window. This is a small change and it is
the difference between a figure that is true and a figure that is decorative.

### 4.4 It knows which days you work

Planner settings gain **working days**, defaulting to Monday through Friday. A
day you do not work has zero capacity and the week view shows it as a quiet gap
rather than nine empty hours. The week's total becomes the sum of the days you
actually work.

### 4.5 Estimates get better without being nagged

A task with no estimate, whose title matches finished work, is offered the median
actual of that work: "Tasks like this have taken about 50m." Matching is on the
task's container plus a simple title-similarity, nothing clever. It is an offer
on the row, never a value written without asking.

## 5. Commitments

### 5.1 What a commitment is

A commitment is a row saying: **this task, owed to this person, by this date, as
of when you said it.**

```
commitments
  id, task_id → tasks.id cascade
  person_id → people.id cascade
  promised_for   (a day)
  promised_at    (the instant you made or moved it)
  note           (what you actually said, optional)
  status('open' | 'kept' | 'missed' | 'released')
```

Re-promising a date **inserts a new row**. The table is its own history: no
change log, no extra machinery. The current promise is the newest open row for
the task, and "you have moved this date twice" is a count.

`promised_for` is deliberately separate from `tasks.dueDate`. A due date is when
a thing is due. A commitment is what you told a person. They are often the same
and the difference matters exactly when it matters most.

### 5.2 Where commitments come from

- **By hand**, from any task row: "Promised to…" picks a person and a date.
- **From a meeting.** The meeting note already has an `## Actions` section that
  nothing parses. The meeting page gains a step that reads those lines, proposes
  one commitment per line with a person guessed from the attendees and a date
  guessed from the text, and lets you accept, edit or discard each. Nothing is
  created without a click — this is a proposal, not an extraction that writes.

### 5.3 What they buy

- **A person's page** gains what you owe them and what is overdue, so a one-to-one
  starts with you knowing rather than remembering.
- **The planner's day** shows a commitment chip on any planned task that has one,
  naming the person.
- **The kept-word record.** On closing a commitment the app records kept or
  missed against the promised date, and the person page carries one plain line:
  "11 of 12 kept." Not a score, not a streak, not a badge — a count, stated once,
  because the research on streaks in the last design applies here too.

### 5.4 The restraint

Commitments are never created silently, never assigned to someone else, and never
shared anywhere. This is a private record of what you said, for your own use.
Nothing here posts, emails, or notifies another person.

## 6. The watch

One surface, `/planner`'s top strip and a line on Home, answering: what is going
to go wrong, while there is still time to do something about it.

Five rules, each stated as a sentence, each with the one action that fixes it:

| It says | When |
| --- | --- |
| "Due Thursday, no time set aside" | A task due within the forecast horizon with no session booked before its due date |
| "Promised to Anita for Friday, not planned" | An open commitment whose date is inside the horizon with no session before it |
| "Carried four times" | A task whose `daily_plan_entries` rows number four or more |
| "Open three weeks, never started" | A task older than 21 days with no focus run and no session |
| "Wednesday is about 2h over" | A day whose forecast exceeds what that day holds |

The horizon is **seven days**. Beyond that it is noise.

The carry count and the task's age need no new data: `carryOver` already leaves
the old `daily_plan_entries` row behind, so every day a task was ever planned is
already recorded and has simply never been counted.

**The watch is capped at five lines.** More than five and it becomes a second
inbox, which is the thing every "at risk" panel in every tool becomes before
people stop reading it. Over five, the last line reads "and four more".

When nothing is at risk the watch renders **nothing at all**. Not "all clear" —
nothing. Its silence is the signal.

## 7. Smarter placement

`fillDay` places one day. Two changes make it a planner rather than a filler:

**Deadline-aware ordering.** Work whose due date or commitment date is nearest
gets placed first, so the thing due Wednesday lands before the thing due Friday
regardless of which you added first.

**Plan the week.** `fillWeek(from)` places unscheduled plan tasks across the
working days of the week, respecting each day's remaining capacity **after
drift**, and never placing work after the day it is due. It answers with what it
could not fit and why, in words: "Three tasks, about 4h, would not fit before
their dates." That sentence is the feature. A planner that silently drops what
does not fit is worse than no planner.

## 8. What this does not build

- **No recurring tasks.** `tasks.recurrence` stays the dead column it is. It is
  its own piece of work with its own edge cases.
- **No team or shared commitments.** Nothing leaves this machine.
- **No priority scoring, no urgency algorithm, no "focus score".** The research
  behind the last design applies: a number you can game replaces the judgement it
  was meant to support.
- **No automatic rescheduling.** The app says what does not fit. Moving it is
  the person's decision, every time.

## 9. Sources

- [Planning fallacy — Wikipedia](https://en.wikipedia.org/wiki/Planning_fallacy)
- [The planning fallacy: why we underestimate how long a task will take](https://nesslabs.com/planning-fallacy)
- [The Planning Fallacy: An Inside View — SPSP](https://spsp.org/news-center/character-context-blog/planning-fallacy-inside-view)
- [Reference class forecasting — Wikipedia](https://en.wikipedia.org/wiki/Reference_class_forecasting)
- [From Nobel Prize to Project Management: Getting Risks Right](https://arxiv.org/pdf/1302.3642)
- [Top Ten Behavioral Biases in Project Management](https://arxiv.org/pdf/2202.00125)
- [Workload planning: how to balance your team's workload](https://www.teamwork.com/blog/workload-planning/)
- [Mastering Capacity Planning (2026)](https://timestripe.com/magazine/blog/capacity-planning/)
- [The Most Important Reliability And Dependability Skills](https://www.zippia.com/advice/reliability-skills/)
- [5 Small Habits That Make You a More Reliable Employee](https://employment-solution.com/5-small-habits-that-make-you-a-more-reliable-employee/)
- [How to Track Action Items: Ensuring Follow-Through](https://fellow.ai/blog/how-to-track-action-items-steps-to-ensure-follow-through/)
- [How to Manage Meeting Action Items So Nothing Falls Through](https://fellow.ai/blog/how-to-manage-meeting-tasks-and-action-items/)
