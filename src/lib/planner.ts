import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items } from "@/db/schema";
import { addDays, getHelperState, listMeetings, localDay } from "@/domain/activity";
import { listContainers } from "@/domain/containers";
import { listPlan, unfinished } from "@/domain/plan";
import { listTasks } from "@/domain/tasks";
import { parseMeta } from "@/domain/items";
import { serializeContainers, serializeMeeting, serializePlanTask, serializeTask } from "./api";
import { freeMinutes, plannedMinutes } from "./capacity";
import { partitionDue } from "./partition";
import { getWorkHours } from "./work-hours";
import type { MeetingItemDTO, MeetingListDTO, PlannerCalendarDTO, PlannerDayDTO, PlannerSourcesDTO, PlannerWeekDTO, SourceGroupDTO } from "./dto";

/** What the Planner tells the setup card about the helper's calendar access. */
export function plannerCalendar(db: DB): PlannerCalendarDTO {
  const helper = getHelperState(db);
  return { calendarsSeen: helper.calendarsSeen, permission: helper.permissions?.calendar ?? false };
}

/** Open tasks grouped by home: inbox (no container), then every active project and area. A task
 * in an archived container is in no group; it still shows under `due` when it is dated. */
export function plannerSources(db: DB, date: string, plannedIds: Set<number>): PlannerSourcesDTO {
  const open = listTasks(db, { status: "open" }).map(serializeTask);
  const unplanned = open.filter((t) => !plannedIds.has(t.id));
  const groups = (kind: "project" | "area"): SourceGroupDTO[] => {
    const containers = serializeContainers(db, listContainers(db, { kind, status: "active" }));
    return containers
      .map((container) => ({ container, tasks: open.filter((t) => t.containerId === container.id) }))
      .sort((a, b) => (b.tasks.length > 0 ? 1 : 0) - (a.tasks.length > 0 ? 1 : 0));
  };
  return {
    inbox: open.filter((t) => t.containerId === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    due: partitionDue(unplanned.filter((t) => t.dueDate !== null && t.dueDate <= date), date),
    projects: groups("project"),
    areas: groups("area"),
  };
}

/**
 * One day of the Planner: the day's plan, what yesterday left open, what is due and not
 * already planned, the day's meetings, and the calendar's state.
 */
export function plannerDay(db: DB, date: string): PlannerDayDTO {
  const plan = listPlan(db, date).map(serializePlanTask);
  const plannedIds = new Set(plan.map((t) => t.id));
  // Only what the day can show: `partitionDue` keeps the late and the due-today, so a task
  // due next month never needs loading.
  const open = listTasks(db, { status: "open", dueOnOrBefore: date })
    .filter((t) => !plannedIds.has(t.id))
    .map(serializeTask);
  const workHours = getWorkHours(db);
  const meetings = plannerMeetings(db, { from: date, to: addDays(date, 1) });
  const { planned, unestimated } = plannedMinutes(plan);
  return {
    date,
    plan,
    unfinishedYesterday: unfinished(db, addDays(date, -1)).map(serializeTask),
    due: partitionDue(open, date),
    // The same flagged meetings the list view shows, so the timeline can badge them too.
    meetings,
    calendar: plannerCalendar(db),
    sources: plannerSources(db, date, plannedIds),
    capacity: { freeMinutes: freeMinutes(meetings, workHours, date), plannedMinutes: planned, unestimated, workHours },
  };
}

/** Seven days from `start`, each with its meetings and the tasks due on it. */
export function plannerWeek(db: DB, start: string): PlannerWeekDTO {
  const end = addDays(start, 7);
  const byDay = new Map<string, ReturnType<typeof serializeMeeting>[]>();
  for (const ev of listMeetings(db, { from: start, to: end })) {
    const day = localDay(ev.startsAt);
    const list = byDay.get(day);
    if (list) list.push(serializeMeeting(ev));
    else byDay.set(day, [serializeMeeting(ev)]);
  }
  // The week's last day is the latest one a column can hold; anything later is not shown.
  const open = listTasks(db, { status: "open", dueOnOrBefore: addDays(start, 6) }).map(serializeTask);
  const workHours = getWorkHours(db);
  return {
    start,
    days: Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => {
      const meetings = byDay.get(date) ?? [];
      return {
        date,
        meetings,
        due: open.filter((t) => t.dueDate === date),
        capacity: { freeMinutes: freeMinutes(meetings, workHours, date), plannedMinutes: plannedMinutes(listPlan(db, date)).planned },
      };
    }),
  };
}

/** The seed line `captureMeeting` leaves under Actions for the first action to be typed on. */
const EMPTY_ACTION = /^[-*]\s*\[\s*\]\s*$/;
const NOTES_HEADING = /^##\s+Notes\s*$/;
const ACTIONS_HEADING = /^##\s+Actions\s*$/;

/**
 * Whether a meeting note holds anything a person wrote. `captureMeeting` seeds every meeting
 * item with a when/who preamble, an empty Notes heading, and one empty `- [ ]`, so a non-empty
 * body says nothing on its own: only text under Notes, or an action beyond the seed, counts.
 * A body that is not that template at all is judged by whether it has any text.
 */
export function hasUserNotes(body: string): boolean {
  const lines = body.split("\n");
  const notesAt = lines.findIndex((l) => NOTES_HEADING.test(l));
  const actionsAt = lines.findIndex((l) => ACTIONS_HEADING.test(l));
  if (notesAt === -1 && actionsAt === -1) return body.trim().length > 0;
  const notesEnd = actionsAt === -1 ? lines.length : actionsAt;
  if (notesAt !== -1 && lines.slice(notesAt + 1, notesEnd).some((l) => l.trim().length > 0)) return true;
  if (actionsAt === -1) return false;
  return lines.slice(actionsAt + 1).some((l) => l.trim().length > 0 && !EMPTY_ACTION.test(l.trim()));
}

/** What each linked meeting item already holds, so rows can badge without loading items. */
function itemFlags(db: DB, ids: number[]): Map<number, MeetingItemDTO> {
  const flags = new Map<number, MeetingItemDTO>();
  if (ids.length === 0) return flags;
  for (const row of db.select().from(items).where(inArray(items.id, ids)).all()) {
    const meta = parseMeta(row);
    flags.set(row.id, {
      id: row.id,
      hasNotes: hasUserNotes(row.body),
      hasTranscript: !!meta.transcript,
      hasSummary: !!meta.summary,
    });
  }
  return flags;
}

/** Meetings in `[from, to)`, each carrying its item's badges when it has been captured. */
export function plannerMeetings(db: DB, opts: { from: string; to: string; q?: string }): MeetingListDTO[] {
  const meetings = listMeetings(db, opts).map(serializeMeeting);
  const flags = itemFlags(
    db,
    meetings.map((m) => m.itemId).filter((id): id is number => id !== null),
  );
  return meetings.map((m) => {
    const item = m.itemId === null ? undefined : flags.get(m.itemId);
    return item ? { ...m, item } : m;
  });
}
