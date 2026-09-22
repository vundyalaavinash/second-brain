import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items } from "@/db/schema";
import { addDays, getHelperState, listMeetings, localDay } from "@/domain/activity";
import { listPlan, unfinished } from "@/domain/plan";
import { listTasks } from "@/domain/tasks";
import { parseMeta } from "@/domain/items";
import { partitionDue } from "@/components/planner/partition";
import { serializeMeeting, serializePlanTask, serializeTask } from "./api";
import type { MeetingItemDTO, MeetingListDTO, PlannerCalendarDTO, PlannerDayDTO, PlannerWeekDTO } from "./dto";

/** What the Planner tells the setup card about the helper's calendar access. */
export function plannerCalendar(db: DB): PlannerCalendarDTO {
  const helper = getHelperState(db);
  return { calendarsSeen: helper.calendarsSeen, permission: helper.permissions?.calendar ?? false };
}

/**
 * One day of the Planner: the day's plan, what yesterday left open, what is due and not
 * already planned, the day's meetings, and the calendar's state.
 */
export function plannerDay(db: DB, date: string): PlannerDayDTO {
  const plan = listPlan(db, date).map(serializePlanTask);
  const planned = new Set(plan.map((t) => t.id));
  const open = listTasks(db, { status: "open" })
    .filter((t) => !planned.has(t.id))
    .map(serializeTask);
  return {
    date,
    plan,
    unfinishedYesterday: unfinished(db, addDays(date, -1)).map(serializeTask),
    due: partitionDue(open, date),
    meetings: listMeetings(db, { from: date, to: addDays(date, 1) }).map(serializeMeeting),
    calendar: plannerCalendar(db),
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
  const open = listTasks(db, { status: "open" }).map(serializeTask);
  return {
    start,
    days: Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => ({
      date,
      meetings: byDay.get(date) ?? [],
      due: open.filter((t) => t.dueDate === date),
    })),
  };
}

/** What each linked meeting item already holds, so rows can badge without loading items. */
function itemFlags(db: DB, ids: number[]): Map<number, MeetingItemDTO> {
  const flags = new Map<number, MeetingItemDTO>();
  if (ids.length === 0) return flags;
  for (const row of db.select().from(items).where(inArray(items.id, ids)).all()) {
    const meta = parseMeta(row);
    flags.set(row.id, {
      id: row.id,
      hasNotes: row.body.trim().length > 0,
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
