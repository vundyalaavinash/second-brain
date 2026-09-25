# The Meetings You Should Be In

**Date:** 2026-09-25
**Status:** approved

## 1. Two things I checked before designing

### 1.1 The app cannot send a decline, and never will through this path

`EKParticipant.participantStatus` is read-only in EventKit. So is
`EKCalendarItem.attendees`. Apple has never exposed a way to change your own RSVP
from the framework; the documented position is that you must use Apple's own
event-editing interface. There is no version of this design where pressing a
button in this app sends a decline to the organiser through the helper.

It is doubly moot here, because the meetings actually arriving come from a
published calendar feed, and a published feed is read-only by definition. There
is nothing to reply to.

So **a decline in this app is a decision, not a message.** That is worth having
on its own — it is what the planner, the capacity line and the auto-recorder all
need to know — but the design has to say so plainly rather than let a button
imply something it does not do. Where sending the real reply matters, the app's
job is to take you to where you can send it in one click.

### 1.2 The app currently believes the wrong thing about every meeting

`CalendarReader.swift` maps `EKEventStatus` — the *event's* own state — onto this
app's meeting status:

```
.confirmed → "accepted"     .tentative → "tentative"
.canceled  → "declined"     default    → "none"
```

`EKEventStatus` is whether the **event** is confirmed, tentative or cancelled. It
is not your RSVP. So today:

- A meeting **you declined** arrives as `accepted`, because the event itself is
  confirmed. It then counts against your capacity, appears in your day, and is
  eligible for auto-recording.
- A meeting **the organiser cancelled** arrives as `declined`, which is the one
  status the capacity line already excludes — right outcome, wrong reason, and it
  is indistinguishable from a meeting you turned down.

Your own RSVP *is* readable: the attendee list carries an `isCurrentUser` flag
and each participant has a `participantStatus`. It is only writing that is
barred. So this is a bug with a fix, not a limitation.

A cancelled meeting and a meeting you declined are different facts and the app
needs both.

## 2. What the research says

The numbers are worse than the intuition. The average professional attends around
25 meetings a week and spends about **31 hours a month in meetings they consider
unproductive** — close to four working days. Past three or four meetings in a
day, deep work stops being possible at all.

Two findings shape the design:

**A meeting audit works, and it works on recurring series.** Structured audits cut
meeting time by 25 to 40%. The method is consistent across every source: take each
standing meeting and ask whether it still has a purpose, whether it produces
outcomes, whether the attendees are right, whether the frequency is right, and
whether it could be asynchronous. The unit of review is the **series**, not the
single occurrence, because that is where the recurring cost lives.

**Declining is the polite option, not the rude one.** The framing that recurs is
that attending a meeting you cannot contribute to is the discourtesy; the rudeness
is in taking a seat and adding nothing. That matters for the copy in this feature,
which should never make a decline feel like an admission.

Sources in §9.

## 3. The thing only this app can do

Every meeting-audit tool asks you to remember or estimate. This app does not have
to ask, because it already holds three things nothing else has together:

- **It records and transcribes the meeting**, so it knows whether anything was
  said, written down, or decided.
- **The activity helper knows what your machine was doing**, minute by minute,
  for the whole hour the meeting ran.
- **It owns your plan**, so it knows what the hour cost you.

Cross those and the audit stops being a survey and becomes evidence:

> **Weekly platform sync** · Thursdays, 60 minutes · 8 of the last 8 attended
> You were in the editor for 47 of the last 60 minutes. No notes were taken in
> the last six. Nothing has been assigned to you from it since July.

No other tool can write that sentence, because no other tool has both halves. It
is also, deliberately, **evidence rather than a verdict**. The app does not say
"decline this". It says what happened and lets the person draw the conclusion,
because the one thing it cannot know is whether being in the room mattered.

## 4. Your own answer

A local status on each meeting, independent of whatever the calendar says:

| | |
| --- | --- |
| **Going** | The default for anything you have not answered |
| **Not going** | Excluded from capacity, from the day, from auto-recording |
| **Maybe** | Counts as half against capacity; still recordable |

With an optional line of why, which is the part you will want in six weeks when
the series comes up for review.

Three properties matter:

**It survives the sync.** The calendar feed refreshes constantly and overwrites
what it owns. Your answer is yours and lives in its own column, the way
`noRecord` already does. A calendar that changes its mind never erases a decision
you made.

**It says what it does not do.** Under "Not going" sits one line: *This is your
record, not a reply. Open in Calendar to tell the organiser.* And a button that
does exactly that. No button in this app will imply it sent something it did not.

**It applies to the series or the one.** Declining a single occurrence and
stepping out of a standing meeting are different acts, and the control asks
which — once, at the point of deciding, not buried in a setting.

## 5. Seeing what you turned down

A filter on the meetings view: everything, or only the ones you are not going to.
Re-accepting is one click from the same row, because a decision you cannot reverse
is one people are afraid to make.

Declined meetings stay in the record permanently. They are the evidence the audit
runs on, and a week where you declined six things is a week you should be able to
look at.

## 6. A meeting belongs somewhere

A meeting can be tagged to a project or an area, the same containers everything
else in the app uses. Then:

- A project page lists the meetings that belong to it, alongside its tasks and
  notes, so the whole thread of a piece of work is in one place.
- The meetings view can be filtered to one project.
- The audit can say that a series belongs to a project that closed in July.

Tagging is manual, and the app may **offer** a container it has reason to suspect
— from the title, the attendees, or a project whose notes mention the same
people — but it never assigns one on its own. A meeting filed to the wrong
project is worse than one filed nowhere, because the first is wrong quietly.

## 7. The audit

A view that groups the last ninety days of meetings into series and shows, for
each: how often it runs, how many hours it has taken, how many you attended, what
it produced, and what you were actually doing while it ran.

Ordered by hours taken, because the recurring hour is the one worth examining and
the rare three-hour workshop is not.

Each row carries the evidence and one control: **Not going** for the next one, or
for the series. No score, no ranking, no "meeting health". The research is clear
that the audit's value is in the five questions, and those are questions for the
person, not for the software.

And one figure at the top, which is the whole argument in a line: hours in
meetings this week, as a share of the working week the planner already knows
about.

## 8. What this does not build

- **No sending of any reply, ever.** §1.1. Where a real RSVP matters, the app
  opens the place where you can send one.
- **No automatic declining**, no rules that decline on your behalf, no
  "meeting-free Fridays" enforcement. Every decline is a decision a person made.
- **No meeting score.** A number replaces the judgement the audit exists to
  prompt, and it is a number you would learn to game within a fortnight.
- **No cost-in-currency estimate.** Multiplying attendees by a guessed salary
  produces an authoritative-looking figure resting on a number nobody has.
- **No speaker attribution from the transcript.** "You spoke twice in eight
  meetings" would be the strongest evidence of all, and the transcription in place
  does not separate speakers. Inferring it would be guessing about something
  consequential.

## 9. Sources

- [participantStatus — Apple Developer Documentation](https://developer.apple.com/documentation/eventkit/ekparticipant/participantstatus)
- [EKParticipant — Apple Developer Documentation](https://developer.apple.com/documentation/eventkit/ekparticipant)
- [Discover Calendar and EventKit — WWDC23](https://developer.apple.com/videos/play/wwdc2023/10052/)
- [Calendar Time Audit Guide — Reclaim](https://reclaim.ai/blog/calendar-time-audit)
- [Meeting Cost Calculator — Reclaim](https://reclaim.ai/meeting-cost-calculator)
- [Recurring Meeting Audit Routine — Littlebird](https://littlebird.ai/routines/recurring-meeting-audit)
- [Kill the Meetings That Serve No Purpose — TimeCraft Advisory](https://www.timecraftadvisory.com/blog/the-recurring-meeting-audit)
- [How Running a Meeting Audit Cut Our Team's Meetings by 34%](https://www.meetingtoll.com/blog/how-to-do-a-meeting-audit)
- [How to Decline a Meeting Professionally](https://get-alfred.ai/blog/how-to-decline-a-meeting-professionally)
- [Best Software to Reduce Meetings — Flowtrace](https://www.flowtrace.co/collaboration-blog/best-software-to-reduce-meetings)
