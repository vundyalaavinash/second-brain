import { and, asc, gt, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents } from "@/db/schema";
import { dayBounds, findCapturedMeetingItem, isInterview } from "./calendar";

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

function clippedSessions(db: DB, day: string): DaySession[] {
  const { start, end } = dayBounds(day);
  return db
    .select()
    .from(activitySessions)
    .where(and(lt(activitySessions.startedAt, end), gt(activitySessions.endedAt, start)))
    .orderBy(asc(activitySessions.startedAt))
    .all()
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt < start ? start : s.startedAt,
      endedAt: s.endedAt > end ? end : s.endedAt,
      appId: s.appId,
      appName: s.appName,
      title: s.title,
      domain: s.domain,
      categoryId: s.categoryId,
      afk: s.afk === 1,
      meetingId: s.meetingId,
    }));
}

const ms = (s: DaySession) => Date.parse(s.endedAt) - Date.parse(s.startedAt);

function sumBy<K>(rows: DaySession[], key: (s: DaySession) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const s of rows) m.set(key(s), (m.get(key(s)) ?? 0) + ms(s));
  return m;
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
    itemId: findCapturedMeetingItem(db, ev.id)?.id ?? null,
  }));
  return { day, activeMs: active.reduce((a, s) => a + ms(s), 0), sessions, byCategory, byApp, bySite, meetings };
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
