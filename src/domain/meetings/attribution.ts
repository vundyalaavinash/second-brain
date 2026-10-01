import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calendarEvents, containers, meetingSeriesContainers } from "@/db/schema";
import { MeetingError } from "./errors";

/**
 * Which project or area a meeting counts against: this occurrence's own assignment first, then
 * whatever its series says, then nothing. Same shape as `effectiveDecision`, and deliberately
 * without that function's time scoping -- see `meetingSeriesContainers` for why an assignment
 * applies to occurrences that already happened and a decision does not.
 */
export function effectiveContainerId(
  event: { containerId: number | null; seriesId: string | null },
  seriesContainerId: number | null,
): number | null {
  if (event.containerId !== null) return event.containerId;
  return seriesContainerId;
}

/** Series id -> assigned container, for every series named. */
export function seriesContainers(db: DB, seriesIds: string[]): Map<string, number> {
  const ids = [...new Set(seriesIds.filter((s): s is string => Boolean(s)))];
  if (ids.length === 0) return new Map();
  const rows = db
    .select()
    .from(meetingSeriesContainers)
    .where(inArray(meetingSeriesContainers.seriesId, ids))
    .all();
  return new Map(rows.map((r) => [r.seriesId, r.containerId]));
}

export type AttributionScope = "occurrence" | "series";

/**
 * Assigns a meeting to a project or area, either for this occurrence alone or for every
 * occurrence of its series.
 *
 * A series write clears the occurrence's own override on the row it was issued from, so the
 * series answer is what that row resolves to afterwards -- otherwise clicking "every time" on the
 * very meeting you are looking at would appear to do nothing, because its own override still won.
 *
 * Passing `containerId: null` clears the assignment at that scope.
 */
export function assignMeetingContainer(
  db: DB,
  eventId: number,
  containerId: number | null,
  scope: AttributionScope,
  now = new Date(),
): void {
  const event = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!event) throw new MeetingError("No such meeting");

  if (containerId !== null) {
    const container = db.select().from(containers).where(eq(containers.id, containerId)).get();
    if (!container) throw new MeetingError("No such project or area");
    if (container.kind !== "project" && container.kind !== "area") {
      throw new MeetingError("Meetings can only be assigned to a project or an area");
    }
  }

  if (scope === "occurrence") {
    db.update(calendarEvents).set({ containerId }).where(eq(calendarEvents.id, eventId)).run();
    return;
  }

  if (!event.seriesId) {
    // Refused rather than quietly downgraded to an occurrence write the caller never asked for.
    throw new MeetingError("This meeting is not part of a series");
  }
  db.transaction((tx) => {
    if (containerId === null) {
      tx.delete(meetingSeriesContainers).where(eq(meetingSeriesContainers.seriesId, event.seriesId!)).run();
    } else {
      const values = { seriesId: event.seriesId!, containerId, assignedAt: now.toISOString() };
      tx.insert(meetingSeriesContainers)
        .values(values)
        .onConflictDoUpdate({ target: meetingSeriesContainers.seriesId, set: values })
        .run();
    }
    tx.update(calendarEvents).set({ containerId: null }).where(eq(calendarEvents.id, eventId)).run();
  });
}

export interface ContainerMeetingRollup {
  containerId: number;
  meetings: number;
  minutes: number;
  /** Recurring series that land in this container, heaviest first -- what the time is going to. */
  series: { title: string; occurrences: number; minutes: number }[];
}

/**
 * What a project or area has actually cost in meetings over `[from, to)`, resolving each
 * occurrence through its own assignment then its series'.
 *
 * All-day entries are excluded: a holiday or an out-of-office block spans 24 hours and would
 * swamp every real meeting in the total, which would make the number useless rather than merely
 * imprecise.
 */
export function containerMeetingRollup(
  db: DB,
  containerId: number,
  range: { from: string; to: string },
): ContainerMeetingRollup {
  const rows = db
    .select({
      title: calendarEvents.title,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      seriesId: calendarEvents.seriesId,
      ownContainerId: calendarEvents.containerId,
      seriesContainerId: meetingSeriesContainers.containerId,
    })
    .from(calendarEvents)
    .leftJoin(meetingSeriesContainers, eq(calendarEvents.seriesId, meetingSeriesContainers.seriesId))
    .where(
      and(
        gte(calendarEvents.day, range.from),
        lt(calendarEvents.day, range.to),
        eq(calendarEvents.allDay, 0),
        sql`coalesce(${calendarEvents.containerId}, ${meetingSeriesContainers.containerId}) = ${containerId}`,
      ),
    )
    .all();

  const byTitle = new Map<string, { title: string; occurrences: number; minutes: number }>();
  let minutes = 0;
  for (const row of rows) {
    const length = Math.max(0, (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60000);
    minutes += length;
    // Grouped by series where there is one, falling back to the title so a one-off still shows up
    // as itself rather than being dropped from the breakdown entirely.
    const key = row.seriesId ?? `title:${row.title}`;
    const entry = byTitle.get(key) ?? { title: row.title, occurrences: 0, minutes: 0 };
    entry.occurrences += 1;
    entry.minutes += length;
    byTitle.set(key, entry);
  }

  return {
    containerId,
    meetings: rows.length,
    minutes: Math.round(minutes),
    series: [...byTitle.values()]
      .map((s) => ({ ...s, minutes: Math.round(s.minutes) }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** Meetings in `[from, to)` that no project or area claims -- the accountability gap. */
export function unattributedMeetings(
  db: DB,
  range: { from: string; to: string },
): { id: number; title: string; startsAt: string; minutes: number; seriesId: string | null }[] {
  return db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      seriesId: calendarEvents.seriesId,
    })
    .from(calendarEvents)
    .leftJoin(meetingSeriesContainers, eq(calendarEvents.seriesId, meetingSeriesContainers.seriesId))
    .where(
      and(
        gte(calendarEvents.day, range.from),
        lt(calendarEvents.day, range.to),
        eq(calendarEvents.allDay, 0),
        sql`coalesce(${calendarEvents.containerId}, ${meetingSeriesContainers.containerId}) is null`,
      ),
    )
    .all()
    .map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt,
      minutes: Math.round(Math.max(0, (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 60000)),
      seriesId: r.seriesId,
    }));
}
