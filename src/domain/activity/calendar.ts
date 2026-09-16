import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents, items, type CalendarEvent, type Item } from "@/db/schema";
import { createItem } from "@/domain/items";
import { ActivityError, listCategories } from "./rules";

export interface CalendarEventInput {
  externalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: number;
  hasCallLink: boolean;
}

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight to next local midnight, as UTC ISO strings. */
export function dayBounds(day: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ActivityError("Day must be YYYY-MM-DD");
  const [y, m, d] = day.split("-").map(Number);
  return { start: new Date(y, m - 1, d).toISOString(), end: new Date(y, m - 1, d + 1).toISOString() };
}

export function isInterview(title: string): boolean {
  return /interview/i.test(title);
}

export function replaceCalendarEvents(db: DB, events: CalendarEventInput[]): { days: string[]; inserted: number } {
  const days = [...new Set(events.map((e) => localDay(e.startsAt)))];
  let inserted = 0;
  db.transaction((tx) => {
    if (days.length) tx.delete(calendarEvents).where(inArray(calendarEvents.day, days)).run();
    for (const e of events) {
      if (Date.parse(e.endsAt) <= Date.parse(e.startsAt)) continue;
      const values = {
        externalId: e.externalId,
        title: e.title.trim() || "Untitled event",
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        attendees: e.attendees,
        hasCallLink: e.hasCallLink ? 1 : 0,
        day: localDay(e.startsAt),
      };
      tx.insert(calendarEvents).values(values).onConflictDoUpdate({ target: calendarEvents.externalId, set: values }).run();
      inserted++;
    }
  });
  labelMeetings(db, days);
  return { days, inserted };
}

export function findMeetingFor(db: DB, at: string): CalendarEvent | undefined {
  return db
    .select()
    .from(calendarEvents)
    .where(and(lt(calendarEvents.startsAt, at), gt(calendarEvents.endsAt, at)))
    .orderBy(desc(calendarEvents.hasCallLink), asc(calendarEvents.startsAt))
    .get();
}

/** Attach events to unlabelled Meetings-category sessions on the given days. Returns rows changed. */
export function labelMeetings(db: DB, days: string[]): number {
  const meetings = listCategories(db).find((c) => c.name === "Meetings");
  if (!meetings || days.length === 0) return 0;
  let changed = 0;
  for (const day of days) {
    const { start, end } = dayBounds(day);
    const rows = db
      .select()
      .from(activitySessions)
      .where(
        and(
          eq(activitySessions.categoryId, meetings.id),
          isNull(activitySessions.meetingId),
          lt(activitySessions.startedAt, end),
          gt(activitySessions.endedAt, start),
        ),
      )
      .all();
    for (const s of rows) {
      const ev = findMeetingFor(db, s.startedAt) ?? findMeetingFor(db, s.endedAt);
      if (ev) {
        db.update(activitySessions).set({ meetingId: ev.id }).where(eq(activitySessions.id, s.id)).run();
        changed++;
      }
    }
  }
  return changed;
}

export function findCapturedMeetingItem(db: DB, eventId: number): Item | undefined {
  return db
    .select()
    .from(items)
    .where(sql`json_extract(${items.meta}, '$.calendarEventId') = ${eventId}`)
    .get();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function captureMeeting(db: DB, eventId: number): Item {
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!ev) throw new ActivityError("Meeting not found", 404);
  const existing = findCapturedMeetingItem(db, eventId);
  if (existing) return existing;
  const body = [
    `**When:** ${localDay(ev.startsAt)} ${fmtTime(ev.startsAt)} to ${fmtTime(ev.endsAt)}`,
    `**Who:** ${ev.attendees} attendees`,
    "",
    "## Notes",
    "",
    "## Actions",
    "",
    "- [ ] ",
  ].join("\n");
  return createItem(db, {
    type: "meeting",
    title: ev.title,
    body,
    status: "ready",
    meta: { calendarEventId: ev.id, interview: isInterview(ev.title) },
  });
}
