import { localDay } from "@/lib/time";
import type { MeetingDecision } from "@/db/enums";

/** The pieces of a meeting capacity needs; both MeetingListDTO and CalendarEvent satisfy it.
 * `decision` is the *effective* decision, already resolved by the caller (`effectiveDecision` in
 * `@/domain/meetings/decision`) — this file has no business knowing about series overrides, and
 * no business reading the calendar's own raw RSVP `status` either, so the type does not carry it. */
export type CapacityMeeting = { startsAt: string; endsAt: string; allDay: boolean; decision: MeetingDecision };

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

/** Minutes from local midnight to `d`'s own wall-clock time. */
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

type Span = { start: number; end: number };

/** Sorted, non-overlapping spans covering the same minutes as `spans` — a double booking is
 * measured once, not twice, the same rule `freeMinutes` has always followed for `going` time. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** The parts of `spans` (already merged) that `cover` (already merged) does not already claim.
 * Used to keep a `maybe` meeting from costing anything extra over time a `going` meeting already
 * occupies — the going meeting already claims that minute at full weight, so an overlapping
 * maybe on top of it adds nothing, and only the part of the maybe that stands on its own costs
 * its own half. */
function outsideCover(spans: Span[], cover: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    let cursor = s.start;
    for (const c of cover) {
      if (c.end <= cursor || c.start >= s.end) continue;
      if (c.start > cursor) out.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
      if (cursor >= s.end) break;
    }
    if (cursor < s.end) out.push({ start: cursor, end: s.end });
  }
  return out;
}

/**
 * What one already-clipped span of meeting time costs against capacity, on its own: nothing for
 * `not-going` (never reaches here in practice — `freeMinutes` excludes it before any span is
 * built — but the function is honest about it rather than assuming); half its duration for
 * `maybe`, because a half-commitment still holds half a slot; its full duration for `going`,
 * exactly what a meeting has always cost here. Minutes are not rounded — nothing else in this
 * file rounds before `formatMinutes` does, at display time.
 */
export function meetingCost(span: { start: number; end: number; decision: MeetingDecision }): number {
  const minutes = Math.max(0, span.end - span.start);
  if (span.decision === "not-going") return 0;
  return span.decision === "maybe" ? minutes / 2 : minutes;
}

/**
 * Working minutes not taken by timed meetings. Overlapping meetings are merged first so a
 * double booking is not subtracted twice; a meeting spilling past the hours only costs the
 * part inside them. `not-going` meetings cost nothing and are dropped before any of this; a
 * `going` meeting costs its full clipped duration; a `maybe` meeting costs half of it, except
 * where it overlaps a `going` meeting — that time is already fully spoken for, so the overlap
 * adds nothing on top (`outsideCover`).
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
    const today = localDay(opts.now.toISOString());
    if (date < today) return 0;
    if (date === today) start = Math.max(start, minutesOfDay(opts.now));
    if (start >= hours.end) return 0;
  }
  const clip = (m: CapacityMeeting): Span => ({
    start: Math.max(start, minutesInto(date, m.startsAt)),
    end: Math.min(hours.end, minutesInto(date, m.endsAt)),
  });
  const timed = meetings.filter((m) => !m.allDay && m.decision !== "not-going");
  const going = mergeSpans(
    timed
      .filter((m) => m.decision === "going")
      .map(clip)
      .filter((s) => s.end > s.start),
  );
  const maybe = mergeSpans(
    timed
      .filter((m) => m.decision === "maybe")
      .map(clip)
      .filter((s) => s.end > s.start),
  );
  const goingTaken = going.reduce((n, s) => n + meetingCost({ ...s, decision: "going" }), 0);
  const maybeTaken = outsideCover(maybe, going).reduce((n, s) => n + meetingCost({ ...s, decision: "maybe" }), 0);
  return hours.end - start - goingTaken - maybeTaken;
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

/** "3 h in meetings this week, about 18% of the working week." -- design §7 (the meeting audit)
 * calls this "the whole argument in a line". Shared between the audit page and Home so the two
 * can never disagree about the same week's figure. */
export function meetingShareLine(share: { minutes: number; workingMinutes: number }): string {
  const pct = share.workingMinutes > 0 ? Math.round((share.minutes / share.workingMinutes) * 100) : 0;
  return `${formatMinutes(share.minutes)} in meetings this week, about ${pct}% of the working week.`;
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

/** The pieces of a day's forecast an over-commitment judgement needs; both `CapacityDTO` and
 * `PlannerWeekDayDTO`'s capacity satisfy it. */
export type CapacityForecast = { plannedMinutes: number; forecastMinutes: number | null; drift: number | null };

/**
 * The figure to judge a day's plan against: the forecast when there is one (spec §4.2 — once a
 * forecast exists it is the figure that counts), the plan itself when there is not (drift below
 * `DRIFT_MIN_PAIRS` still deserves an honest comparison, not silence — see the capacity line's
 * overrun sentence). Shared by every place that judges overcommitment, so a bar and a sentence
 * reading the same day can never disagree about which number is being judged.
 */
export function overBasis(capacity: CapacityForecast): number {
  return capacity.drift !== null && capacity.forecastMinutes !== null ? capacity.forecastMinutes : capacity.plannedMinutes;
}
