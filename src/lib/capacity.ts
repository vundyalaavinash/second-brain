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

/** `YYYY-MM-DD` for the local calendar day `iso` falls on, built from local date components —
 * never `new Date(iso).toISOString().slice(0, 10)`, which names the UTC day and is a day out
 * anywhere west of Greenwich. */
function localDayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Minutes from local midnight to `d`'s own wall-clock time. */
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Working minutes not taken by timed meetings. Overlapping meetings are merged first so a
 * double booking is not subtracted twice; a meeting spilling past the hours only costs the
 * part inside them.
 *
 * `opts.now`, when given, makes the window honest about the time: a day already gone holds
 * nothing, and the part of today that has already passed is not free time either — the
 * scheduler has always known this (`notBefore`); this figure never did. Every existing caller
 * passes no `opts`, so nothing changes under them — the window stays the whole working day.
 */
export function freeMinutes(meetings: CapacityMeeting[], workHours: string, date: string, opts: { now?: Date } = {}): number {
  const hours = parseWorkHours(workHours);
  if (!hours) return 0;
  let start = hours.start;
  if (opts.now) {
    const today = localDayOf(opts.now);
    if (date < today) return 0;
    if (date === today) start = Math.max(start, minutesOfDay(opts.now));
    if (start >= hours.end) return 0;
  }
  const busy = meetings
    .filter((m) => !m.allDay && m.status !== "declined")
    .map((m) => ({ start: Math.max(start, minutesInto(date, m.startsAt)), end: Math.min(hours.end, minutesInto(date, m.endsAt)) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  let taken = 0;
  let cursor = -Infinity;
  for (const b of busy) {
    const busyStart = Math.max(b.start, cursor);
    if (b.end > busyStart) taken += b.end - busyStart;
    cursor = Math.max(cursor, b.end);
  }
  return hours.end - start - taken;
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

export const DEFAULT_BLOCK_MINUTES = 25;
export function blockLength(task: { estimateMinutes: number | null }): number {
  return task.estimateMinutes ?? DEFAULT_BLOCK_MINUTES;
}
/** The pieces of a session capacity needs; both BlockDTO and TaskBlock satisfy it. */
export type CapacityBlock = { startsAt: string; minutes: number };

/** Minutes of the day held by open tasks' sessions. */
export function blockedMinutes(tasks: { status: string; blocks: CapacityBlock[] }[], date: string): number {
  return tasks
    .filter((t) => t.status === "open")
    .reduce((n, t) => n + t.blocks.filter((b) => b.startsAt.startsWith(date)).reduce((m, b) => m + b.minutes, 0), 0);
}

/** What the day's open tasks still want and have nowhere to sit: estimate minus what is placed
 * on the day, per task. A task nobody has estimated asks for nothing. */
export function unplacedMinutes(tasks: { status: string; estimateMinutes: number | null; blocks: CapacityBlock[] }[], date: string): number {
  return tasks
    .filter((t) => t.status === "open" && t.estimateMinutes !== null)
    .reduce((n, t) => n + Math.max(0, t.estimateMinutes! - t.blocks.filter((b) => b.startsAt.startsWith(date)).reduce((m, b) => m + b.minutes, 0)), 0);
}

export type CapacityTone = "ok" | "warn" | "danger";

/** How a capacity figure is coloured, wherever one is shown. */
export const CAPACITY_TONE_CLASS: Record<CapacityTone, string> = { ok: "text-fg-muted", warn: "text-warn", danger: "text-danger" };

/** Fine up to the free time, warn past it, danger past a quarter over. */
export function capacityTone(planned: number, free: number): CapacityTone {
  if (planned <= free) return "ok";
  if (free === 0) return "danger";
  return planned > free * 1.25 ? "danger" : "warn";
}
