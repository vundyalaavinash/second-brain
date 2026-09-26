import { and, asc, gte, inArray, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calendarEvents, items, tasks, type CalendarEvent } from "@/db/schema";
import { dayBounds } from "@/domain/activity/calendar";
import { activityBetween, capturedItemsFor, topApps, type DaySession } from "@/domain/activity/report";
import { meetingCost, parseWorkHours } from "@/lib/capacity";
import { hasUserNotes, meetingItemFlags } from "@/lib/planner";
import { getWorkHours, getWorkingDays } from "@/lib/work-hours";
import { weekDays } from "@/lib/week";
import { effectiveDecision, seriesDecisionsFor } from "./decision";

/** A recurring meeting's occurrences over some window, condensed into what the five audit
 * questions (design §3, §7) need to be asked, not answered: how often, how much, whether you
 * showed up, whether it produced anything on paper, and what you were actually doing while it
 * ran. Nothing here scores or ranks; it is evidence for the reader to weigh themselves. */
export interface SeriesAudit {
  seriesId: string | null;
  title: string;
  occurrences: number;
  totalMinutes: number;
  attendedCount: number;
  lastNoteAt: string | null;
  hasTranscript: boolean;
  tasksSince: number;
  topActivity: { label: string; ms: number }[];
}

/** How many apps' worth of "what ran during it" the evidence sentence names — the same figure
 * `activityToday` (home.ts) and `focusWhere` (domain/focus) already settled on for "the three
 * things that took most of it". */
const TOP_ACTIVITY_LIMIT = 3;

/** The item captured from `ev`, by either path a capture can take: `calendarEvents.itemId`
 * itself, or a row that only ever recorded `meta.calendarEventId` (an ad-hoc recording later
 * linked back) — the same fallback `getDay` reads meetings through. */
function occurrenceItemId(ev: CalendarEvent, capturedByEvent: Map<number, number>): number | null {
  return ev.itemId ?? capturedByEvent.get(ev.id) ?? null;
}

/** Total overlap, in ms, between an occurrence's own window and every session in `sessions` —
 * `sessions` is already the whole audit window's activity, fetched once; this only slices each
 * occurrence's own share out of it, in memory, rather than asking the database again per
 * occurrence. A meeting's audit must not attribute a minute of activity to time outside it, so
 * every overlap is clipped to the occurrence's own start and end before it is counted. */
function activityDuring(ev: { startsAt: string; endsAt: string }, sessions: DaySession[]): { appId: string | null; appName: string | null; domain: string | null; ms: number }[] {
  const start = Date.parse(ev.startsAt);
  const end = Date.parse(ev.endsAt);
  const out: { appId: string | null; appName: string | null; domain: string | null; ms: number }[] = [];
  for (const s of sessions) {
    const overlapStart = Math.max(start, Date.parse(s.startedAt));
    const overlapEnd = Math.min(end, Date.parse(s.endedAt));
    if (overlapEnd > overlapStart) out.push({ appId: s.appId, appName: s.appName, domain: s.domain, ms: overlapEnd - overlapStart });
  }
  return out;
}

/**
 * Every recurring meeting series that ran between `since` and `now`, grouped and ordered by
 * total minutes taken (design §7: the recurring hour is worth examining, the rare long workshop
 * is not). All-day placeholders (out-of-office, holidays) are excluded before grouping — they
 * carry no real meeting duration, and an all-day row's nominal 24 hours would otherwise swamp
 * every real series' total on nothing but a calendar-app convention.
 *
 * A null `seriesId` should not occur post-Task-1 (every event now gets one), but is guarded
 * anyway: it groups as its own singleton, keyed on the event's own id, rather than being lumped
 * into one shapeless "no series" bucket or dropped.
 *
 * Batched, not per-row, the same way this repo has now required three times over: one query for
 * the window's events, one for their series decisions, one for which of them were captured into
 * an item, one for those items' own rows, one for the tasks any of those items produced, and one
 * for the whole window's activity (`activityBetween`, called exactly once here — each
 * occurrence's own slice of it is then found by overlap in memory, the same "one query for the
 * whole list" rule applied to activity as it already is to tasks and decisions, not one call per
 * occurrence).
 */
export function auditSeries(db: DB, opts: { since: string; now?: Date }): SeriesAudit[] {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const events = db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.startsAt, opts.since), lt(calendarEvents.startsAt, nowIso)))
    .orderBy(asc(calendarEvents.startsAt))
    .all()
    .filter((ev) => ev.allDay !== 1);
  if (events.length === 0) return [];

  const groups = new Map<string, { seriesId: string | null; events: CalendarEvent[] }>();
  for (const ev of events) {
    const key = ev.seriesId ?? `__solo:${ev.id}`;
    const group = groups.get(key);
    if (group) group.events.push(ev);
    else groups.set(key, { seriesId: ev.seriesId, events: [ev] });
  }

  const seriesIds = [...new Set(events.map((ev) => ev.seriesId).filter((id): id is string => id !== null))];
  const decisions = seriesDecisionsFor(db, seriesIds);

  const eventIds = events.map((ev) => ev.id);
  const capturedByEvent = capturedItemsFor(db, eventIds);
  const itemIds = [...new Set(events.map((ev) => occurrenceItemId(ev, capturedByEvent)).filter((id): id is number => id !== null))];
  const itemRows = itemIds.length ? db.select().from(items).where(inArray(items.id, itemIds)).all() : [];
  const itemById = new Map(itemRows.map((row) => [row.id, row]));

  // Every task ever produced from any of these items, not just open ones -- "what it produced"
  // is a historical fact the audit reports, not a live worklist.
  const taskRows = itemIds.length ? db.select({ sourceItemId: tasks.sourceItemId }).from(tasks).where(inArray(tasks.sourceItemId, itemIds)).all() : [];
  const tasksByItem = new Map<number, number>();
  for (const row of taskRows) {
    if (row.sourceItemId === null) continue;
    tasksByItem.set(row.sourceItemId, (tasksByItem.get(row.sourceItemId) ?? 0) + 1);
  }

  const windowSessions = activityBetween(db, opts.since, nowIso).filter((s) => !s.afk);

  return [...groups.values()]
    .map((group): SeriesAudit => {
      const occurrences = group.events;
      const latest = occurrences[occurrences.length - 1];
      const totalMinutes = occurrences.reduce((n, ev) => n + (Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 60_000, 0);
      const seriesDecision = group.seriesId ? (decisions.get(group.seriesId) ?? null) : null;
      const attendedCount = occurrences.filter((ev) => effectiveDecision(ev, seriesDecision) !== "not-going").length;

      // `lastNoteAt` names the occurrence, not the row: the most recent occurrence whose captured
      // item actually holds notes, by that occurrence's own `startsAt` -- not the item's own
      // `updatedAt`, which bumps on any edit at all (a title fix, a transcript landing) and would
      // otherwise report "last touched" rather than "last had something written down in it".
      let lastNoteAt: string | null = null;
      let hasTranscript = false;
      for (const ev of occurrences) {
        const id = occurrenceItemId(ev, capturedByEvent);
        if (id === null) continue;
        const row = itemById.get(id);
        if (!row) continue;
        if (hasUserNotes(row.body) && (lastNoteAt === null || ev.startsAt > lastNoteAt)) lastNoteAt = ev.startsAt;
        if (meetingItemFlags(row).hasTranscript) hasTranscript = true;
      }
      // Tasks are counted once per distinct captured item, not once per occurrence that shares
      // it, so a series whose occurrences somehow resolve to the same item never double-counts.
      const occItemIds = [...new Set(occurrences.map((ev) => occurrenceItemId(ev, capturedByEvent)).filter((id): id is number => id !== null))];
      const tasksSince = occItemIds.reduce((n, id) => n + (tasksByItem.get(id) ?? 0), 0);

      const appTimes = occurrences.flatMap((ev) => activityDuring(ev, windowSessions));

      return {
        seriesId: group.seriesId,
        title: latest.title,
        occurrences: occurrences.length,
        totalMinutes,
        attendedCount,
        lastNoteAt,
        hasTranscript,
        tasksSince,
        topActivity: topApps(appTimes, TOP_ACTIVITY_LIMIT),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/**
 * This week's meeting minutes against the working week the planner's own settings define —
 * `getWorkHours`/`getWorkingDays`, the same two figures the capacity line already reads. A
 * meeting's cost follows the same rule the capacity line uses (`meetingCost`, Task 2): nothing
 * for `not-going`, half for `maybe`, its full length for `going`. All-day events are excluded,
 * same as `freeMinutes` and for the same reason: they carry no real clock minutes to spend.
 * `week` is that week's Monday, the same shape `plannerWeek`'s own `start` takes.
 */
export function weeklyMeetingShare(db: DB, week: string): { minutes: number; workingMinutes: number } {
  const days = weekDays(week);
  // Local midnight of the week's first day to local midnight after its last -- `dayBounds`,
  // never a bare `T00:00:00.000Z` suffix, which would read every date as UTC midnight and put
  // the whole window several hours off local wall-clock time (the same class of bug Task 3's
  // review caught in a UTC-morning `startsAt`).
  const from = dayBounds(days[0]).start;
  const to = dayBounds(days[6]).end;

  const weekEvents = db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.startsAt, from), lt(calendarEvents.startsAt, to)))
    .all()
    .filter((ev) => ev.allDay !== 1);

  const seriesIds = [...new Set(weekEvents.map((ev) => ev.seriesId).filter((id): id is string => id !== null))];
  const decisions = seriesDecisionsFor(db, seriesIds);

  const minutes = weekEvents.reduce((n, ev) => {
    const decision = effectiveDecision(ev, ev.seriesId ? (decisions.get(ev.seriesId) ?? null) : null);
    const durationMinutes = (Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 60_000;
    return n + meetingCost({ start: 0, end: durationMinutes, decision });
  }, 0);

  const hours = parseWorkHours(getWorkHours(db));
  const workingMinutes = hours ? getWorkingDays(db).length * (hours.end - hours.start) : 0;
  return { minutes, workingMinutes };
}

/**
 * The soonest still-upcoming occurrence of each of `seriesIds`, one grouped query for the whole
 * list rather than one per series -- what the audit row's "Not going" control needs to write an
 * occurrence-scoped decision against, since `SeriesAudit` itself only ever looks backward and
 * carries no occurrence id of its own. A series with nothing scheduled ahead of `now` (it ended,
 * or every future instance has already been declined off the calendar) has no entry: there is
 * nothing for "just the next one" to mean, and the control falls back to the series as a whole.
 */
export function nextOccurrenceIds(db: DB, seriesIds: string[], now: Date): Map<string, number> {
  const out = new Map<string, number>();
  const ids = [...new Set(seriesIds)];
  if (ids.length === 0) return out;
  const rows = db
    .select({ id: calendarEvents.id, seriesId: calendarEvents.seriesId, startsAt: calendarEvents.startsAt })
    .from(calendarEvents)
    .where(and(inArray(calendarEvents.seriesId, ids), gte(calendarEvents.startsAt, now.toISOString())))
    .orderBy(asc(calendarEvents.startsAt))
    .all();
  for (const row of rows) {
    if (row.seriesId === null || out.has(row.seriesId)) continue;
    out.set(row.seriesId, row.id);
  }
  return out;
}
