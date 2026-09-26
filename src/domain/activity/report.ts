import { and, asc, gt, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents, items, type MeetingStatus, type MeetingDecision } from "@/db/schema";
import { effectiveDecisionAsOf, seriesDecisionDetailsFor } from "@/domain/meetings/decision";
import { dayBounds, isInterview, parseAttendeeNames } from "./calendar";

/** Sessions can span at most a day plus the 15-minute fold gap; two days of slack keeps the started_at index range tight. */
const CLIP_LOOKBACK_MS = 2 * 86_400_000;

export interface DaySession {
  id: number;
  startedAt: string;
  endedAt: string;
  appId: string | null;
  appName: string | null;
  title: string | null;
  domain: string | null;
  categoryId: number | null;
  afk: boolean;
  meetingId: number | null;
}

export interface ActivityMeeting {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: number;
  hasCallLink: boolean;
  interview: boolean;
  scheduledMs: number;
  actualMs: number;
  itemId: number | null;
  organizer: string;
  attendeeNames: string[];
  location: string;
  joinUrl: string | null;
  allDay: boolean;
  status: MeetingStatus;
  calendarTitle: string;
  noRecord: boolean;
  seriesId: string | null;
  decision: MeetingDecision;
  decisionNote: string;
  /** The series' own standing decision, independent of this occurrence's override — see
   * `ActivityMeetingDTO.seriesDecision` (`@/lib/dto`) for why `decision` alone can't answer
   * "is there one to reverse". */
  seriesDecision: MeetingDecision | null;
}

export interface ActivityDay {
  day: string;
  activeMs: number;
  sessions: DaySession[];
  byCategory: { categoryId: number | null; ms: number }[];
  byApp: { appId: string | null; appName: string | null; ms: number }[];
  bySite: { key: string; label: string; ms: number }[];
  meetings: ActivityMeeting[];
}

/**
 * Sessions overlapping an arbitrary UTC instant range `[from, to)`, clipped to it — a sibling of
 * `getDay`'s own per-day query, not a copy of it: the boundary is whatever the caller passes,
 * not a local day's midnight-to-midnight. Reuses the same overlap predicate
 * (`lt(startedAt, to) && gt(endedAt, from)`) and the same lookback bound `clippedSessions` uses
 * for a day, which holds just as well here — a session cannot start more than a day plus the
 * fold gap before it ends, whatever the range's own start is, so bounding the scan by the
 * range's start rather than by the whole table is still correct, not just fast. Built for the
 * meeting audit (`domain/meetings/audit.ts`), which needs one occurrence's own start-to-end
 * window, never a whole day around it.
 */
export function activityBetween(db: DB, from: string, to: string): DaySession[] {
  const lookback = new Date(Date.parse(from) - CLIP_LOOKBACK_MS).toISOString();
  return db
    .select()
    .from(activitySessions)
    .where(and(lt(activitySessions.startedAt, to), gt(activitySessions.endedAt, from), gte(activitySessions.startedAt, lookback)))
    .orderBy(asc(activitySessions.startedAt))
    .all()
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt < from ? from : s.startedAt,
      endedAt: s.endedAt > to ? to : s.endedAt,
      appId: s.appId,
      appName: s.appName,
      title: s.title,
      domain: s.domain,
      categoryId: s.categoryId,
      afk: s.afk === 1,
      meetingId: s.meetingId,
    }));
}

/** A whole local day's sessions, clipped to it — `activityBetween` with a day's own bounds
 * standing in for the arbitrary range. */
function clippedSessions(db: DB, day: string): DaySession[] {
  const { start, end } = dayBounds(day);
  return activityBetween(db, start, end);
}

const ms = (s: DaySession) => Date.parse(s.endedAt) - Date.parse(s.startedAt);

function sumBy<K>(rows: DaySession[], key: (s: DaySession) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const s of rows) m.set(key(s), (m.get(key(s)) ?? 0) + ms(s));
  return m;
}

/**
 * The captured item id for each of `eventIds` (an item recorded through some path other than
 * `itemId` itself, e.g. an ad-hoc recording that only ever wrote `meta.calendarEventId`), in one
 * grouped query rather than one per event — shared by `getDay` and the meeting audit
 * (`domain/meetings/audit.ts`), which both need the same "what got captured" answer for a whole
 * window's worth of events at once.
 */
export function capturedItemsFor(db: DB, eventIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (eventIds.length === 0) return out;
  const eventIdExpr = sql<number>`json_extract(${items.meta}, '$.calendarEventId')`;
  const captured = db
    .select({ id: items.id, eventId: eventIdExpr })
    .from(items)
    .where(inArray(eventIdExpr, eventIds))
    .all();
  for (const row of captured) out.set(row.eventId, row.id);
  return out;
}

export function getDay(db: DB, day: string): ActivityDay {
  const sessions = clippedSessions(db, day);
  const active = sessions.filter((s) => !s.afk);
  const byCategory = [...sumBy(active, (s) => s.categoryId)].map(([categoryId, t]) => ({ categoryId, ms: t })).sort((a, b) => b.ms - a.ms);
  const appNames = new Map(active.map((s) => [s.appId, s.appName]));
  const byApp = [...sumBy(active, (s) => s.appId)]
    .map(([appId, t]) => ({ appId, appName: appNames.get(appId) ?? null, ms: t }))
    .sort((a, b) => b.ms - a.ms);
  const bySite = [...sumBy(active, (s) => s.domain ?? s.title ?? "")]
    .filter(([k]) => k !== "")
    .map(([key, t]) => ({ key, label: key, ms: t }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25);
  const { start, end } = dayBounds(day);
  const events = db
    .select()
    .from(calendarEvents)
    .where(and(lt(calendarEvents.startsAt, end), gt(calendarEvents.endsAt, start)))
    .orderBy(asc(calendarEvents.startsAt))
    .all();
  const eventIds = events.map((ev) => ev.id);
  const capturedByEvent = capturedItemsFor(db, eventIds);
  // One batched series-decision query for the whole day's events, not one per row. Read with
  // `decidedAt` (`seriesDecisionDetailsFor`) rather than the bare decision, because `getDay`
  // serves *any* day, including one months back: a "Not going, every time" click made today must
  // not re-render an hour the person actually sat through last month as declined. That is what
  // `effectiveDecisionAsOf` below is for — the same time-scoped resolution the meeting audit uses,
  // and for the same reason. Nothing changes for a day still ahead.
  const seriesIds = [...new Set(events.map((ev) => ev.seriesId).filter((id): id is string => id !== null))];
  const decisions = seriesDecisionDetailsFor(db, seriesIds);
  const meetings: ActivityMeeting[] = events.map((ev) => ({
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    attendees: ev.attendees,
    hasCallLink: ev.hasCallLink === 1,
    interview: isInterview(ev.title),
    scheduledMs: Date.parse(ev.endsAt) - Date.parse(ev.startsAt),
    actualMs: active.filter((s) => s.meetingId === ev.id).reduce((a, s) => a + ms(s), 0),
    itemId: ev.itemId ?? capturedByEvent.get(ev.id) ?? null,
    organizer: ev.organizer,
    attendeeNames: parseAttendeeNames(ev.attendeeNames),
    location: ev.location,
    joinUrl: ev.joinUrl,
    allDay: ev.allDay === 1,
    status: ev.status,
    calendarTitle: ev.calendarTitle,
    noRecord: ev.noRecord === 1,
    seriesId: ev.seriesId,
    decision: effectiveDecisionAsOf(ev, ev.seriesId ? (decisions.get(ev.seriesId) ?? null) : null),
    decisionNote: ev.decisionNote,
    seriesDecision: (ev.seriesId ? decisions.get(ev.seriesId)?.decision : null) ?? null,
  }));
  return { day, activeMs: active.reduce((a, s) => a + ms(s), 0), sessions, byCategory, byApp, bySite, meetings };
}

/** A slice of time spent in one app, already trimmed to whatever window the caller cares about
 * (a whole day, or the part of a session that overlaps something shorter, like a focus run). */
export interface AppTime {
  appId: string | null;
  appName: string | null;
  domain: string | null;
  ms: number;
}

/**
 * Ranks apps by time spent, at most `limit`. A browser is named by the domain that took most of
 * its time when that domain accounts for over half of it — "Chrome" says nothing the person did
 * not already know, but the site it spent that time on does. Shared by `activityToday` (home.ts)
 * and `focusWhere` (domain/focus) so the naming rule lives in exactly one place.
 */
export function topApps(sessions: AppTime[], limit: number): { label: string; ms: number }[] {
  const byApp = new Map<string, { label: string; ms: number; domains: Map<string, number> }>();
  for (const s of sessions) {
    const key = s.appId ?? s.appName ?? "unknown";
    const row = byApp.get(key) ?? { label: s.appName ?? s.appId ?? "Unknown", ms: 0, domains: new Map<string, number>() };
    row.ms += s.ms;
    if (s.domain) row.domains.set(s.domain, (row.domains.get(s.domain) ?? 0) + s.ms);
    byApp.set(key, row);
  }
  return [...byApp.values()]
    .map((row) => {
      const onSites = [...row.domains.values()].reduce((n, x) => n + x, 0);
      const busiest = [...row.domains.entries()].sort((a, b) => b[1] - a[1])[0];
      return { label: busiest && onSites > row.ms / 2 ? busiest[0] : row.label, ms: row.ms };
    })
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function getWeek(db: DB, start: string): { start: string; days: { day: string; activeMs: number; byCategory: ActivityDay["byCategory"] }[] } {
  dayBounds(start); // validates the format
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
    const d = getDay(db, day);
    return { day, activeMs: d.activeMs, byCategory: d.byCategory };
  });
  return { start, days };
}
