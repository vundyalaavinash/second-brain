import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, tasks, type CalendarEvent, type Task } from "@/db/schema";
import { dayBounds, listMeetings } from "@/domain/activity";
import { listContainers } from "@/domain/containers";
import { focusSummary } from "@/domain/focus";
import { goalsWithMeasure } from "@/domain/goals";
import { countInbox } from "@/domain/items";
import { listPlan, type PlanTask } from "@/domain/plan";
import { getReview, nextStep, reviewAnswers } from "@/domain/review";
import { containerProgress, listTasks } from "@/domain/tasks";
import { localDay } from "./time";
import { nextWeek, weekDays, weekEnd, weekLabel, weekStart } from "./week";
import { serializeGoal, serializeMeeting, serializePlanTasks, serializeTasks } from "./api";
import type { ContainerRefDTO, ReviewDTO } from "./dto";

/** A meeting a person is actually going to be at: not declined, and not all-day — the same rule
 * `homePayload` (src/lib/home.ts) counts by, so Home and the review can never disagree about the
 * same week. */
function isCountableMeeting(ev: CalendarEvent): boolean {
  return ev.allDay !== 1 && ev.status !== "declined";
}

function toContainerRef(c: { id: number; name: string; slug: string; kind: ContainerRefDTO["kind"] }): ContainerRefDTO {
  return { id: c.id, name: c.name, slug: c.slug, kind: c.kind };
}

/**
 * The still-open tasks planned on any day of the week, each counted once however many of the
 * week's days it sits on — a task planned Monday and carried to Tuesday is one thing left open,
 * not two. `clear.leftover` and `back.slipped` both read this same set, as rows and as a count,
 * so the two can never drift apart the way a second query for either would risk.
 */
function weekLeftover(db: DB, days: string[]): PlanTask[] {
  const byId = new Map<number, PlanTask>();
  for (const day of days) {
    for (const task of listPlan(db, day)) {
      if (task.status === "open" && !byId.has(task.id)) byId.set(task.id, task);
    }
  }
  return [...byId.values()];
}

/** Tasks completed inside `[week, end)`, by the local day `completedAt` falls on. Bounded in SQL
 * to `updatedAt >= the week's start` first — `completedAt` and `updatedAt` are written together
 * at the moment a task is completed and `updatedAt` only ever moves later after that, so nothing
 * closed inside the week can fall outside that bound — then narrowed to the exact window in JS,
 * the same two-step `measureFromLinks` (src/domain/goals/index.ts) uses for the same reason. */
function doneInWeek(db: DB, week: string, end: string): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "done"), isNotNull(tasks.completedAt), gte(tasks.updatedAt, dayBounds(week).start)))
    .all()
    .filter((t) => localDay(t.completedAt!) < end);
}

/** Tasks dropped inside `[week, end)`. A drop leaves no timestamp of its own — only `completedAt`
 * exists, and only `done` sets it — so `updatedAt` is read instead: `dropTask` bumps it as part
 * of the same write that sets the status, which makes it the moment the drop happened. */
function droppedInWeek(db: DB, week: string, end: string): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "dropped"), gte(tasks.updatedAt, dayBounds(week).start)))
    .all()
    .filter((t) => localDay(t.updatedAt) < end);
}

/** The projects that closed something this week, each with how many and its overall percent —
 * the same figure `containerProgress` gives every project card, so a project's percent here and
 * on its own page can never read differently. */
function weekProjects(db: DB, done: Task[]): ReviewDTO["back"]["projects"] {
  const closedByContainer = new Map<number, number>();
  for (const t of done) {
    if (t.containerId === null) continue;
    closedByContainer.set(t.containerId, (closedByContainer.get(t.containerId) ?? 0) + 1);
  }
  const ids = [...closedByContainer.keys()];
  if (ids.length === 0) return [];
  const rows = db
    .select({ id: containers.id, name: containers.name, slug: containers.slug, kind: containers.kind })
    .from(containers)
    .where(inArray(containers.id, ids))
    .all();
  const progress = containerProgress(db, ids);
  return rows
    .map((c) => ({ container: toContainerRef(c), closed: closedByContainer.get(c.id) ?? 0, percent: progress.get(c.id)?.percent ?? 0 }))
    .sort((a, b) => b.closed - a.closed || a.container.name.localeCompare(b.container.name));
}

/**
 * The whole review payload for one week: the record it has written so far, and the figures the
 * four panes read. Every figure comes from the domain that already owns it — `countInbox` for
 * the inbox badge, `focusSummary` for booked time, `goalsWithMeasure` for goal progress, the same
 * meeting rule `homePayload` uses — so this and Home can never disagree about the same week.
 */
export function reviewPayload(db: DB, week: string, now: Date): ReviewDTO {
  const days = weekDays(week);
  const end = nextWeek(week);
  const window = { from: week, to: end };
  const today = localDay(now.toISOString());

  const item = getReview(db, week);
  const answers = item ? reviewAnswers(item) : {};

  const leftover = weekLeftover(db, days);
  const doneRows = doneInWeek(db, week, end);
  const droppedRows = droppedInWeek(db, week, end);
  const focus = focusSummary(db, window, now);
  const meetings = listMeetings(db, window).filter(isCountableMeeting);

  const ahead = end;
  const aheadEnd = nextWeek(ahead);
  const aheadWindow = { from: ahead, to: aheadEnd };
  const dueSoon = listTasks(db, { status: "open", dueOnOrBefore: weekEnd(ahead) }).filter((t) => t.dueDate !== null && t.dueDate >= ahead);
  const deadlines = listContainers(db, { kind: "project", status: "active" })
    .filter((c) => c.deadline !== null && c.deadline >= ahead && c.deadline < aheadEnd)
    .map((c) => ({ container: toContainerRef(c), deadline: c.deadline! }));
  const aheadMeetings = listMeetings(db, aheadWindow).filter(isCountableMeeting);

  return {
    week,
    label: weekLabel(week),
    days,
    current: week === weekStart(today),
    step: nextStep(answers),
    answers,
    clear: {
      inbox: countInbox(db),
      leftover: serializePlanTasks(db, leftover, window),
    },
    back: {
      done: doneRows.length,
      dropped: droppedRows.length,
      slipped: leftover.length,
      focusMinutes: focus.minutes,
      focusRuns: focus.runs,
      meetings: meetings.length,
      projects: weekProjects(db, doneRows),
    },
    goals: goalsWithMeasure(db, { status: "active" }, today).map(serializeGoal),
    ahead: {
      week: ahead,
      due: serializeTasks(db, dueSoon, aheadWindow),
      deadlines,
      meetings: aheadMeetings.map(serializeMeeting),
    },
    savedAt: item?.updatedAt ?? null,
  };
}
