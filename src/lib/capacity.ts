/** The pieces of a meeting capacity needs; both MeetingListDTO and CalendarEvent satisfy it. */
export type CapacityMeeting = { startsAt: string; endsAt: string; allDay: boolean; status: string };

const HOURS_RE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

/** "09:00-18:00" as minutes from midnight, or null when it is not a sane range. */
export function parseWorkHours(s: string): { start: number; end: number } | null {
  const m = s.match(HOURS_RE);
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start < end ? { start, end } : null;
}

/** Minutes from local midnight of `date` to the timestamp; timestamps are local ISO strings. */
function minutesInto(date: string, iso: string): number {
  return (new Date(iso).getTime() - new Date(`${date}T00:00:00`).getTime()) / 60_000;
}

/**
 * Working minutes not taken by timed meetings. Overlapping meetings are merged first so a
 * double booking is not subtracted twice; a meeting spilling past the hours only costs the
 * part inside them.
 */
export function freeMinutes(meetings: CapacityMeeting[], workHours: string, date: string): number {
  const hours = parseWorkHours(workHours);
  if (!hours) return 0;
  const busy = meetings
    .filter((m) => !m.allDay && m.status !== "declined")
    .map((m) => ({ start: Math.max(hours.start, minutesInto(date, m.startsAt)), end: Math.min(hours.end, minutesInto(date, m.endsAt)) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  let taken = 0;
  let cursor = -Infinity;
  for (const b of busy) {
    const start = Math.max(b.start, cursor);
    if (b.end > start) taken += b.end - start;
    cursor = Math.max(cursor, b.end);
  }
  return hours.end - hours.start - taken;
}

/** Open tasks' estimates added up, and how many open tasks carry none. */
export function plannedMinutes(tasks: { status: string; estimateMinutes: number | null }[]): { planned: number; unestimated: number } {
  let planned = 0;
  let unestimated = 0;
  for (const t of tasks) {
    if (t.status !== "open") continue;
    if (t.estimateMinutes == null) unestimated += 1;
    else planned += t.estimateMinutes;
  }
  return { planned, unestimated };
}

export function formatMinutes(n: number): string {
  const total = Math.max(0, Math.round(n));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Fine up to the free time, warn past it, danger past a quarter over. */
export function capacityTone(planned: number, free: number): "ok" | "warn" | "danger" {
  if (planned <= free) return "ok";
  if (free === 0) return "danger";
  return planned > free * 1.25 ? "danger" : "warn";
}
