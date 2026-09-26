import { and, asc, gte, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calendarEvents, items, tasks, type CalendarEvent, type MeetingDecision } from "@/db/schema";
import { activityBetween, addDays, capturedItemsFor, dayBounds, listMeetings, localDay, topApps, type DaySession } from "@/domain/activity";
import { meetingCost, parseWorkHours } from "@/lib/capacity";
import { meetingItemFlags } from "@/lib/planner";
import { getWorkHours, getWorkingDays, isWorkingDay } from "@/lib/work-hours";
import { seriesDecisionDetailsFor } from "./decision";

/** How many apps' worth of "what ran during it" the evidence names — the same figure
 * `activityToday` (home.ts) and `focusWhere` (domain/focus) already settled on for "the three
 * things that took most of it". */
const TOP_ACTIVITY_LIMIT = 3;

/**
 * A recurring meeting series' evidence over the audited window — design §7's five questions,
 * asked, not answered: how often, how much, whether you showed up, whether it produced anything
 * on paper, and what you were actually doing while it ran. Only measured counts and minutes;
 * nothing here scores, ranks, or labels a "health".
 */
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

/**
 * `effectiveDecision`, but a series decision only ever governs occurrences at or after the moment
 * it was made. `meetingSeriesDecisions` has no time scoping of its own -- it is one row per
 * series, always current -- so reading it the way every other caller of `effectiveDecision` does
 * (unconditionally, for whatever occurrence is being asked about) would let a "Not going, every
 * time" click made today rewrite whether a person attended a meeting last month: attendance that
 * already happened cannot retroactively become non-attendance because of a decision made after
 * the fact. An occurrence's own override always applies regardless of when it was made, since it
 * was made specifically about that occurrence.
 */
function effectiveDecisionAsOf(ev: CalendarEvent, seriesDecision: { decision: MeetingDecision; decidedAt: string } | null): MeetingDecision {
  if (ev.decision) return ev.decision;
  if (seriesDecision && ev.startsAt >= seriesDecision.decidedAt) return seriesDecision.decision;
  return ev.status === "declined" ? "not-going" : "going";
}

/** The item captured from `ev`, by either path a capture can take: `calendarEvents.itemId`
 * itself, or a row that only ever recorded `meta.calendarEventId` (an ad-hoc recording later
 * linked back) — the same fallback `getDay` reads meetings through (`capturedItemsFor`). */
function occurrenceItemId(ev: CalendarEvent, capturedByEvent: Map<number, number>): number | null {
  return ev.itemId ?? capturedByEvent.get(ev.id) ?? null;
}

/** A window session's own instant bounds, parsed once for the whole window rather than once per
 * occurrence it might overlap — `auditSeries` runs this pass on every server render of a real
 * page, and the window's session list is the same for every occurrence in it. Sorted by start so
 * the bounds read in the same order the events they overlap are likely to, though `activityDuring`
 * below still checks every one; this is a modest hoist, not a smarter algorithm. */
interface SessionBounds {
  start: number;
  end: number;
  appId: string | null;
  appName: string | null;
  domain: string | null;
}

function sessionBounds(sessions: DaySession[]): SessionBounds[] {
  return sessions
    .map((s) => ({ start: Date.parse(s.startedAt), end: Date.parse(s.endedAt), appId: s.appId, appName: s.appName, domain: s.domain }))
    .sort((a, b) => a.start - b.start);
}

/** One occurrence's own slice of `bounds` (the whole window's activity, already fetched and
 * parsed once), clipped to its start and end — a meeting's audit must not attribute a minute of
 * activity to time outside it, so every overlap is clipped before it is counted, in memory,
 * rather than asking the database again for each occurrence. */
function activityDuring(ev: { startsAt: string; endsAt: string }, bounds: SessionBounds[]): { appId: string | null; appName: string | null; domain: string | null; ms: number }[] {
  const start = Date.parse(ev.startsAt);
  const end = Date.parse(ev.endsAt);
  const out: { appId: string | null; appName: string | null; domain: string | null; ms: number }[] = [];
  for (const s of bounds) {
    const overlapStart = Math.max(start, s.start);
    const overlapEnd = Math.min(end, s.end);
    if (overlapEnd > overlapStart) out.push({ appId: s.appId, appName: s.appName, domain: s.domain, ms: overlapEnd - overlapStart });
  }
  return out;
}

/**
 * Every recurring meeting series with an occurrence between `since` (a local day, like every
 * other day string in this app) and `now`, grouped and ordered by total minutes taken — design
 * §7: the recurring hour is worth examining, the rare long workshop is not. All-day placeholders
 * (out-of-office, holidays) are dropped before grouping — they carry no real meeting duration,
 * and one all-day row's nominal 24 hours would otherwise swamp every real series' total on
 * nothing but a calendar-app convention. An occurrence that has not started yet is dropped too:
 * it is not evidence of anything that happened, only something still on the calendar.
 *
 * The window is read through `listMeetings`, the same day-column query the Planner's own meetings
 * list uses, rather than comparing `since` against `startsAt` directly — `since` is a bare local
 * day and `startsAt` a UTC instant, and east of Greenwich a day's early hours fall on the
 * *previous* UTC calendar date, so a raw string comparison between the two would silently drop a
 * real morning meeting off the start of the window under exactly that kind of timezone (the same
 * class of bug design §1.2 opens with).
 *
 * A null `seriesId` should not occur post-Task-1 (every real event now gets one), but is guarded
 * anyway: it groups as its own singleton, keyed on the event's own id, rather than being lumped
 * into one shapeless "no series" bucket shared with every other ownerless row.
 *
 * Batched the same way this repo has now required three times over: one query for the window's
 * events (`listMeetings`), one grouped query for their series decisions, one grouped query for
 * which of them were captured into an item (`capturedItemsFor`), one grouped query for those
 * items' own rows, one grouped query for the tasks any of those items produced, and one query for
 * the window's whole activity (`activityBetween`, called exactly once) — never one query per
 * series. The activity read in particular is one query for the whole window rather than one call
 * per occurrence: each occurrence's own slice of it is found by clipping the already-fetched
 * sessions in memory (`activityDuring`), the same "one query for the whole list" rule applied to
 * activity as it is already applied to tasks and decisions above.
 */
export function auditSeries(db: DB, opts: { since: string; now?: Date }): SeriesAudit[] {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const to = addDays(localDay(nowIso), 1);

  const events = listMeetings(db, { from: opts.since, to }).filter((ev) => ev.allDay !== 1 && ev.startsAt < nowIso);
  if (events.length === 0) return [];

  const groups = new Map<string, { seriesId: string | null; events: CalendarEvent[] }>();
  for (const ev of events) {
    const key = ev.seriesId ?? `event:${ev.id}`;
    const group = groups.get(key);
    if (group) group.events.push(ev);
    else groups.set(key, { seriesId: ev.seriesId, events: [ev] });
  }

  const seriesIds = [...new Set(events.map((ev) => ev.seriesId).filter((id): id is string => id !== null))];
  const decisions = seriesDecisionDetailsFor(db, seriesIds);

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

  // `opts.since` is a bare local day, not a UTC instant -- `activityBetween`'s contract is an
  // arbitrary instant range, so the local day's own start (`dayBounds`, not the bare string
  // itself) is what has to be passed here. Passing the string directly reads as UTC midnight of
  // that date, which east of Greenwich falls *after* the local day actually starts, silently
  // dropping real activity from the audit's own early-morning meetings under exactly the same
  // class of timezone bug already fixed for the event-window read above.
  // Parsed and sorted once for the whole window, not once per occurrence below.
  const windowSessionBounds = sessionBounds(activityBetween(db, dayBounds(opts.since).start, nowIso).filter((s) => !s.afk));

  return [...groups.values()]
    .map((group): SeriesAudit => {
      const occurrences = group.events;
      const latest = occurrences[occurrences.length - 1];
      const totalMinutes = occurrences.reduce((n, ev) => n + (Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 60_000, 0);
      const seriesDecision = group.seriesId ? (decisions.get(group.seriesId) ?? null) : null;
      const attendedCount = occurrences.filter((ev) => {
        const decision = effectiveDecisionAsOf(ev, seriesDecision);
        return decision === "going" || decision === "maybe";
      }).length;

      // `lastNoteAt` names the occurrence, not the row: the most recent occurrence whose captured
      // item actually holds notes, by that occurrence's own `startsAt` -- not the item's own
      // `updatedAt`, which bumps on any edit at all (a title fix, a transcript landing later) and
      // would otherwise report "last touched" rather than "last had something written down in it".
      let lastNoteAt: string | null = null;
      let hasTranscript = false;
      const occItemIds = new Set<number>();
      for (const ev of occurrences) {
        const id = occurrenceItemId(ev, capturedByEvent);
        if (id === null) continue;
        occItemIds.add(id);
        const row = itemById.get(id);
        if (!row) continue;
        const flags = meetingItemFlags(row);
        if (flags.hasNotes && (lastNoteAt === null || ev.startsAt > lastNoteAt)) lastNoteAt = ev.startsAt;
        if (flags.hasTranscript) hasTranscript = true;
      }
      // Tasks are counted once per distinct captured item, not once per occurrence that shares
      // it, so a series whose occurrences somehow resolve to the same item never double-counts.
      const tasksSince = [...occItemIds].reduce((n, id) => n + (tasksByItem.get(id) ?? 0), 0);

      const appTimes = occurrences.flatMap((ev) => activityDuring(ev, windowSessionBounds));

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
 * This week's meeting minutes against the working week the planner's own capacity line already
 * measures — design §7's one figure at the top. A meeting's cost follows the same rule the
 * capacity line uses (`meetingCost`, Task 2): nothing for `not-going`, half for `maybe`, its full
 * length for `going`. All-day events are excluded, the same exclusion `freeMinutes` makes — they
 * carry no real clock minutes to spend. `week` is that week's Monday, the same shape
 * `plannerWeek`'s own `start` takes, and is read the same way `auditSeries` reads its own window:
 * through `listMeetings`'s day column, not a raw instant comparison against a bare day string.
 *
 * Every meeting is clipped to its own day's working-hours window before it is costed, the same
 * way `freeMinutes` clips a day's meetings before subtracting them — a meeting on a non-working
 * day counts for nothing, and one that starts before or runs past the working hours only counts
 * the part of it inside them. Without this the numerator could include time the denominator
 * (working hours only) never counted in the first place, letting the headline read over 100% on
 * nothing but a Saturday meeting or one that ran into the evening.
 *
 * Every 7-day week contains each ISO weekday exactly once regardless of which day it starts on,
 * so the working week's total is just the working-day count times the working hours' length —
 * no need to walk the seven days one at a time to get the same number.
 *
 * Uses `effectiveDecisionAsOf`, the same time-scoped resolution `attendedCount` above uses and
 * for the same reason: a series decided `not-going` mid-week must not retroactively zero out the
 * hours already elapsed earlier that same week under the decision then in force — only occurrences
 * from the moment of the decision onward are affected.
 */
export function weeklyMeetingShare(db: DB, week: string): { minutes: number; workingMinutes: number } {
  const events = listMeetings(db, { from: week, to: addDays(week, 7) }).filter((ev) => ev.allDay !== 1);
  const seriesIds = [...new Set(events.map((ev) => ev.seriesId).filter((id): id is string => id !== null))];
  const decisions = seriesDecisionDetailsFor(db, seriesIds);
  const workHours = getWorkHours(db);
  const hours = parseWorkHours(workHours)!; // getWorkHours only ever returns a value that parses
  const workingDays = getWorkingDays(db);

  const minutes = events.reduce((sum, ev) => {
    const day = localDay(ev.startsAt);
    if (!isWorkingDay(workingDays, day)) return sum;
    const dayStart = Date.parse(dayBounds(day).start);
    const workStart = new Date(dayStart + hours.start * 60_000).toISOString();
    const workEnd = new Date(dayStart + hours.end * 60_000).toISOString();
    const clippedStart = ev.startsAt < workStart ? workStart : ev.startsAt;
    const clippedEnd = ev.endsAt > workEnd ? workEnd : ev.endsAt;
    const end = (Date.parse(clippedEnd) - Date.parse(clippedStart)) / 60_000;
    if (end <= 0) return sum;
    const decision = effectiveDecisionAsOf(ev, ev.seriesId ? (decisions.get(ev.seriesId) ?? null) : null);
    return sum + meetingCost({ start: 0, end, decision });
  }, 0);

  const workingMinutes = workingDays.length * (hours.end - hours.start);
  return { minutes, workingMinutes };
}

/**
 * The soonest still-upcoming occurrence of each of `seriesIds`, one grouped query for the whole
 * list rather than one per series — what the audit row's "Not going" control needs to write an
 * occurrence-scoped decision against, since `SeriesAudit` itself only ever looks backward and
 * carries no occurrence id of its own. A series with nothing scheduled ahead of `now` (it ended,
 * or every future instance has already been declined off the calendar) has no entry: there is
 * nothing for the control to write against, so the view leaves the whole control off that row
 * rather than offering an action it cannot actually take.
 */
export function nextOccurrenceIds(db: DB, seriesIds: string[], now: Date): Map<string, number> {
  const out = new Map<string, number>();
  const ids = [...new Set(seriesIds)];
  if (ids.length === 0) return out;
  const rows = db
    .select({ id: calendarEvents.id, seriesId: calendarEvents.seriesId })
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
