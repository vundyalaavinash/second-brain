# Closing the Loop — Goals, Focus and the Weekly Review

**Date:** 2026-09-24
**Status:** approved

## 1. What the research says

I read across the 2026 write-ups on second-brain apps, goal trackers, focus
timers, weekly-review practice and note resurfacing. Four findings repeat
often enough to design against, and one of them is a warning.

**The gap is execution, not planning.** Every "why productivity apps fail"
piece lands on the same sentence: setup solves a planning problem, and the
app never tells you what to do *now*. This app is already strong at planning
— capture, PARA, a plan for the day, sessions on a timeline. It has nothing
that runs *during* the work.

**Goals kept apart from daily tasks are goals you drop.** The goal-tracker
comparisons all rank on one axis: does progress compute itself from the work
you actually closed, or do you hand-type a percentage? The tools people keep
are the ones where finishing a task moves the goal without being told.

**A review you repeat beats a review you admire.** The GTD writing is
unanimous that a twenty-minute weekly pass you actually do beats the
ninety-minute version you skip, and that the reason people skip it is that
nothing assembles the week for them.

**Focus timers earn their keep only inside the task manager.** A standalone
timer is a toy. A timer that attaches its minutes to the task turns into a
record of what work really costs — which is the open question this app left
hanging when it started asking for estimates.

**The warning: streaks backfire.** The habit-tracker retrospectives are
consistent, and the self-determination-theory argument behind them is sound:
a streak converts "I want to do this" into "I want the number to stay
alive", and the first miss takes the motivation with it. Habits modelled as
recurring tasks have a second failure — they flood the list until the one
item that genuinely needed today's attention is buried. So this design has
no streaks and no habit list. That is a decision, not an omission.

Sources are listed in §10.

## 2. What this builds

One loop, in three parts, each of which is useless alone and compounding
together:

- **Goals** give the work a direction, and take their progress from the
  tasks already being closed against the projects beneath them.
- **Focus** runs the clock while the work happens, and books the real
  minutes against the task.
- **The weekly review** closes the loop: it assembles what the week did,
  shows which goals moved, and sets next week going.

Direction, execution, reflection. The app already owns the middle of the
week; these are its two ends and the engine in between.

## 3. Goals

### 3.1 What a goal is

A goal is an outcome with a date, sitting one level above projects. It
carries:

| Field | Meaning |
| --- | --- |
| `title` | What you are going for. |
| `outcome` | One sentence describing what being finished looks like. |
| `horizon` | `quarter` or `year`. Nothing shorter — a month is a project. |
| `targetDate` | The day it is meant to be true by. Required. |
| `status` | `active`, `hit`, `missed`, `dropped`. |
| `notes` | Free text, the same editor the containers use. |

A goal links to any number of projects and areas. The link is the whole
mechanism: a project under a goal contributes its tasks to that goal's
progress. `containers.goal` is a different and older thing — a sentence on a
single project — and stays as it is.

### 3.2 Progress computes itself

A goal's progress is `done / (open + done)` across the tasks of every
container linked to it. There is no hand-typed percentage anywhere, because
the research is unambiguous that hand-typed progress is the thing people
stop updating in week three.

Two figures, not one:

- **Progress** — the share of the linked work that is finished. Slow-moving,
  and on a quarter goal it is mostly flat. Alone it is discouraging.
- **Movement** — tasks closed against this goal in the last seven days. This
  is the number that answers "did I touch this at all", and it is the one
  the weekly review leads with.

A goal with no linked container, or no task closed against it in fourteen
days, is **stalled**, and says so plainly: "Nothing closed on this in three
weeks." No badge, no colour alarm, no guilt copy. The research calls this
gentle accountability and it is the only nudge in the design.

### 3.3 Where a goal shows up

- **`/goals`** — the list. Active goals first, nearest target date first,
  each with its outcome, its two figures, its linked projects and the days
  left. Hit, missed and dropped goals sit behind a "Closed" disclosure.
- **`/goals/[id]`** — one goal: its outcome, its notes, its linked
  containers with each one's own progress, and the tasks closed against it
  most recently.
- **On a project or area page** — a line naming the goals it serves, so the
  link is visible from both ends.
- **On the plan and the Home dashboard** — a planned task whose project
  serves a goal carries a faint goal chip. This is the connective tissue the
  research keeps naming: the daily row knows what it is for.
- **In the weekly review** — step three is goals, and nothing else.

### 3.4 Days left

A goal past its target date and still active reads "overdue by N days" and
sorts first. Closing it asks which of `hit`, `missed` or `dropped` it was —
the distinction matters for looking back and costs one click.

## 4. Focus

### 4.1 A run

A focus run is a countdown bound to a task. It records when it started, when
it ended, how long it was meant to be, how long it actually ran, and how it
finished.

| Outcome | Meaning |
| --- | --- |
| `completed` | The clock reached zero. |
| `stopped` | Ended early, on purpose, with the minutes kept. |
| `abandoned` | Ended under two minutes in, or discarded by the person. |

Only `completed` and `stopped` runs contribute minutes.

### 4.2 How long

Not a fixed twenty-five minutes. The research splits cleanly: short blocks
help with work you are avoiding, and sixty to ninety minutes is where
demanding work actually gets done. So the length offered is, in order:

1. **The session's own length**, when the run starts from a placed session.
   The plan already decided this work is forty-five minutes; the timer
   should not argue.
2. **25 or 50 minutes**, offered as the two other choices.
3. A saved default for an ad-hoc run, 25 minutes out of the box.

### 4.3 Breaks

After a completed run the app offers a break: five minutes, or fifteen after
the fourth completed run of the day. It is a line with a button, never a
modal and never automatic. A break is not recorded as a run and nothing
counts breaks taken.

### 4.4 What the minutes buy

This is the point of the feature, not a side effect.

- **The task learns what it cost.** A task's detail shows estimate against
  actual once any run has landed on it: "Estimated 45m, spent 1h 20m."
- **The estimate can be corrected from the actual** with one button, so the
  next task of that shape is guessed better. This is the answer to the
  question the sessions work left open — how anyone is meant to know how
  long a thing takes. They are not. They find out, once, and the app
  remembers.
- **The day knows how much of it was focused.** Home and the review both
  show focused minutes for the day and the week.

### 4.5 Was it actually focused

The activity helper already records which app and which site the machine was
on, minute by minute. When a run ends, the app can say where the time went:
"48 min focused — 39 in the editor, 6 on github.com." No score, no
judgement, one sentence. Nothing else in this class of app can do this,
because nothing else already has the data.

When the helper has never reported, the line is simply absent.

### 4.6 Where it lives

- **The dock** gets a focus chip beside the recording chip: the task's name
  and the countdown, so the run survives navigating anywhere. Clicking it
  goes back to the task.
- **A session on the timeline** gets a "Focus" action.
- **A plan row** gets one too.
- **Home** shows the run in place of "Now" while it is going.
- **`⌘⇧F`** starts a run on the task the current row is on, or resumes the
  running one.

One run at a time. Starting a second stops the first as `stopped`.

## 5. The weekly review

### 5.1 Shape

A guided pass in four steps, at `/review`, working on an ISO week named by
its Monday. It writes exactly one item of type `review` per week — the item
type already exists in the schema and has been waiting for this.

The four steps, in order, each one pane with the next step's button at the
bottom:

**1. Clear.** The inbox, processed down. Anything still open in the plans of
the week just gone, with carry / drop / leave for each. This is GTD's "get
clear" and it is first because everything after it lies if the list is
stale.

**2. Look back.** Assembled, not asked for: tasks done, dropped and slipped;
focused minutes; meetings held; the projects that moved and by how much. One
free-text box: what went well, what did not.

**3. Goals.** Every active goal with its movement for the week and its days
left, each with a line to write against it. A stalled goal says so here
first. This is the step the research says every other app is missing.

**4. Look ahead.** Next week's due tasks, deadlines and meetings already on
the calendar. One box for the week's intention. A "plan it" control that
drops chosen tasks onto next week's days.

Each step saves as it is left, so an interrupted review resumes where it
stopped rather than starting over.

### 5.2 The record

The finished review is an item: the four free-text answers as its body, and
a snapshot of the figures in its meta. It reads back in the Library like any
note, which means a quarter of reviews is a searchable record of how the
work actually went — and the semantic search already indexes it.

### 5.3 The prompt

From Friday morning, Home carries one quiet line if the current week has no
review yet: "Review your week." It does not grow, repeat, or turn red on
Sunday. If the week ends without one, the week ends without one.

## 6. Data model

Three new tables and one new settings key. No existing column changes
meaning.

```
goals
  id, title, outcome, horizon('quarter'|'year'), target_date,
  status('active'|'hit'|'missed'|'dropped'), notes,
  sort_order, closed_at, created_at, updated_at
  index (status, target_date)

goal_links
  goal_id -> goals.id on delete cascade
  container_id -> containers.id on delete cascade
  unique (goal_id, container_id), index (container_id)

focus_runs
  id, task_id -> tasks.id on delete cascade (nullable)
  block_id -> task_blocks.id on delete set null (nullable)
  started_at, ended_at (nullable while running),
  planned_minutes, actual_minutes (nullable while running),
  outcome('completed'|'stopped'|'abandoned') nullable while running
  index (task_id), index (started_at)
```

The weekly review needs no table: it is `items` with `type = 'review'`, its
`title` naming the week, and its `meta` holding the week start and the
snapshot.

Settings gains `focus` — `{ defaultMinutes, shortBreak, longBreak,
longBreakEvery }`, defaulting to 25 / 5 / 15 / 4.

`tasks.recurrence` is an unused column from an earlier design. It stays
unused; this work does not build recurring tasks and does not remove it.

## 7. API

```
GET    /api/goals                    list, with progress and movement
POST   /api/goals                    create
GET    /api/goals/:id                one goal, links and recent closes
PATCH  /api/goals/:id                edit, close, reopen
DELETE /api/goals/:id
PUT    /api/goals/:id/links          set the linked container ids

GET    /api/focus                    the running run, or null
POST   /api/focus                    start { taskId, blockId?, minutes }
PATCH  /api/focus/:id                finish { outcome }
GET    /api/focus/summary?date=|week= minutes, by task

GET    /api/review?week=YYYY-MM-DD   the assembled week and the saved item
PATCH  /api/review?week=YYYY-MM-DD   save a step's answers
POST   /api/review/plan              carry chosen tasks into next week
```

All of them go through the existing `crossSite` guard and the zod schemas in
`src/lib/validation.ts`.

## 8. What this does not build

Stated so that the omissions read as choices:

- **No habit tracker and no streaks.** §1 gives the reason. If daily
  practices want a home later, they want one that survives a missed day.
- **No recurring tasks.** A separate piece of work with its own edge cases,
  and modelling habits as recurring tasks is a known failure.
- **No spaced repetition of notes.** Resurfacing is real value, but this
  app's search is already semantic and the right version of resurfacing
  builds on the connections slice that is still unbuilt.
- **No shared or team OKRs.** This is one person's second brain.
- **No numeric key results.** A goal's progress comes from the work beneath
  it. Typed-in metrics are the thing people stop updating.

## 9. Testing

Every domain module gets its own unit tests against a temp database, the way
`src/domain/blocks` and `src/lib/scheduler.ts` are covered now:

- **Goals** — progress and movement across linked containers, including a
  goal linked to an archived project, a goal with no links, the stalled
  rule at its boundary, and closing and reopening.
- **Focus** — one run at a time, a second start stopping the first, the
  under-two-minutes abandon rule, minutes summing per task and per day, and
  a run whose task is deleted underneath it.
- **Review** — the week's figures against a seeded week, resuming a
  half-finished review, and the carry-into-next-week action.
- **Components** — jsdom tests for the goal list, the focus chip's
  countdown, and each review step, matching how the planner panes are
  tested.

The retired-class guard in `src/test/tokens.test.ts` applies unchanged.

## 10. Sources

- [The second brain apps that will redefine thinking in 2026](https://www.supernormal.com/blog/best-second-brain-apps)
- [Best Second Brain Apps in 2026: 16 Ranked by Use Case](https://www.recall.it/compare/best-second-brain-apps)
- [7 Best Second Brain Apps (2026): Cognitive-Load Tested](https://www.atlasworkspace.ai/blog/best-second-brain-apps)
- [Goal Tracking Apps: OKRs and Personal Goals Compared (2026)](https://clickup.com/learn/topic/productivity/tools/features/goal-tracking/)
- [14 Best Goal Tracker Apps for 2026](https://reclaim.ai/blog/goal-tracker-apps)
- [Pomodoro Timer Apps: Focus Sessions and Stats Compared (2026)](https://clickup.com/learn/topic/productivity/tools/features/pomodoro-timer/)
- [Deep Work Timer](https://www.deepworktimer.io/)
- [The Weekly Review: A Productivity Ritual to Get More Done](https://www.todoist.com/productivity-methods/weekly-review)
- [GTD Weekly Review: Step-by-Step Guide + Checklist (2026)](https://www.asianefficiency.com/productivity/gtd-weekly-review/)
- [Why All-in-One Productivity Apps Keep Failing](https://home.journalit.app/blog/why-productivity-apps-fail)
- [Why Habit Streaks Are Sabotaging Your Productivity](https://xenith.life/articles/why-habit-streaks-dont-work)
- [Why Most Habit Trackers Stop Working After a Few Weeks](https://compounddaily.collabtower.com/blog/why-most-habit-trackers-stop-working)
- [Personal Knowledge Management (2026): The Practical Guide](https://www.atlasworkspace.ai/blog/personal-knowledge-management)
