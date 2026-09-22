import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents, items, type CalendarEvent, type Item, type MeetingStatus } from "@/db/schema";
import { createItem } from "@/domain/items";
import { ActivityError, listCategories } from "./rules";

export interface CalendarEventInput {
  externalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: number;
  hasCallLink: boolean;
  organizer?: string;
  attendeeNames?: string[];
  location?: string;
  joinUrl?: string | null;
  notes?: string;
  allDay?: boolean;
  status?: MeetingStatus;
  calendarTitle?: string;
}

/** Known meeting providers first; any https link is a usable fallback. */
const PROVIDER_RE = /https?:\/\/[^\s<>"')]*(?:teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com)[^\s<>"')]*/i;
const ANY_RE = /https?:\/\/[^\s<>"')]+/i;

/** The first meeting link in any of the texts, else the first url, else null. */
export function joinUrlFrom(...texts: (string | null | undefined)[]): string | null {
  const joined = texts.filter(Boolean).join(" ");
  return joined.match(PROVIDER_RE)?.[0] ?? joined.match(ANY_RE)?.[0] ?? null;
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
  const externalIds = events.map((e) => e.externalId);
  let inserted = 0;
  db.transaction((tx) => {
    // The calendar owns everything but our own two columns, so carry those across the delete-and-reinsert.
    const kept = new Map<string, { itemId: number | null; noRecord: number }>();
    if (days.length) {
      const rows = tx
        .select({ externalId: calendarEvents.externalId, itemId: calendarEvents.itemId, noRecord: calendarEvents.noRecord })
        .from(calendarEvents)
        .where(
          externalIds.length
            ? or(inArray(calendarEvents.day, days), inArray(calendarEvents.externalId, externalIds))
            : inArray(calendarEvents.day, days),
        )
        .all();
      for (const row of rows) kept.set(row.externalId, { itemId: row.itemId, noRecord: row.noRecord });
      tx.delete(calendarEvents).where(inArray(calendarEvents.day, days)).run();
    }
    for (const e of events) {
      if (Date.parse(e.endsAt) <= Date.parse(e.startsAt)) continue;
      const joinUrl = e.joinUrl ?? joinUrlFrom(e.location, e.notes);
      const prior = kept.get(e.externalId);
      const values = {
        externalId: e.externalId,
        title: e.title.trim() || "Untitled event",
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        attendees: e.attendees,
        hasCallLink: joinUrl || e.hasCallLink ? 1 : 0,
        day: localDay(e.startsAt),
        organizer: e.organizer ?? "",
        attendeeNames: JSON.stringify(e.attendeeNames ?? []),
        location: e.location ?? "",
        joinUrl,
        notes: e.notes ?? "",
        allDay: e.allDay ? 1 : 0,
        status: e.status ?? "none",
        calendarTitle: e.calendarTitle ?? "",
        itemId: prior?.itemId ?? null,
        noRecord: prior?.noRecord ?? 0,
      };
      tx.insert(calendarEvents).values(values).onConflictDoUpdate({ target: calendarEvents.externalId, set: values }).run();
      inserted++;
    }
  });
  labelMeetings(db, days);
  return { days, inserted };
}

/** The stored attendee-name JSON as a list of names; tolerant of anything else. */
export function parseAttendeeNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** Events starting on a day in [from, to), oldest first; `q` matches title, organizer, or an attendee name. */
export function listMeetings(db: DB, opts: { from: string; to: string; q?: string }): CalendarEvent[] {
  const rows = db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.day, opts.from), lt(calendarEvents.day, opts.to)))
    .orderBy(asc(calendarEvents.startsAt))
    .all();
  const q = opts.q?.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((e) => [e.title, e.organizer, e.attendeeNames].join(" ").toLowerCase().includes(q));
}

export function findMeetingFor(db: DB, at: string): CalendarEvent | undefined {
  return db
    .select()
    .from(calendarEvents)
    .where(and(lte(calendarEvents.startsAt, at), gt(calendarEvents.endsAt, at)))
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
  const ev = db.select({ itemId: calendarEvents.itemId }).from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (ev?.itemId) {
    const linked = db.select().from(items).where(eq(items.id, ev.itemId)).get();
    if (linked) return linked;
  }
  return db
    .select()
    .from(items)
    .where(sql`json_extract(${items.meta}, '$.calendarEventId') = ${eventId}`)
    .get();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function captureMeeting(db: DB, eventId: number): Item {
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!ev) throw new ActivityError("Meeting not found", 404);
  const existing = findCapturedMeetingItem(db, eventId);
  if (existing) {
    if (ev.itemId !== existing.id) db.update(calendarEvents).set({ itemId: existing.id }).where(eq(calendarEvents.id, ev.id)).run();
    return existing;
  }
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
  const item = createItem(db, {
    type: "meeting",
    title: ev.title,
    body,
    status: "ready",
    meta: { calendarEventId: ev.id, interview: isInterview(ev.title) },
  });
  db.update(calendarEvents).set({ itemId: item.id }).where(eq(calendarEvents.id, ev.id)).run();
  return item;
}
