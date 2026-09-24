import { parseWorkHours } from "./capacity";

export type Span = { start: number; end: number };
export const SESSION_FLOOR = 15;
export const DEFAULT_SESSION = 45;
export const WHOLE_UP_TO = 60;
/** The break a task takes between two of its own sessions laid in the same free slot. */
export const SESSION_GAP = 10;
const SNAP = 5;

const up = (n: number, step = SNAP) => Math.ceil(n / step) * step;

/** Merges overlapping spans in place order. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** The working hours with the busy spans taken out, nothing before `notBefore`, no slot under `minSlot`. */
export function freeSlots(busy: Span[], workHours: string, opts: { notBefore?: number; minSlot?: number }): Span[] {
  const hours = parseWorkHours(workHours);
  if (!hours) return [];
  const minSlot = opts.minSlot ?? SESSION_FLOOR;
  let cursor = Math.max(hours.start, opts.notBefore === undefined ? hours.start : up(opts.notBefore));
  const out: Span[] = [];
  for (const b of merge(busy)) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, hours.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= hours.end) break;
  }
  if (cursor < hours.end) out.push({ start: cursor, end: hours.end });
  return out.filter((s) => s.end - s.start >= minSlot);
}

/** How long each session should be for this task. */
export function sessionsFor(estimate: number | null, sessionMinutes: number | null): number[] {
  if (estimate === null) return [25];
  // No session is shorter than the floor, whatever the estimate: a ten-minute task is one
  // fifteen-minute session, because anything less is a block too thin to read or to press.
  if (estimate < SESSION_FLOOR) return [SESSION_FLOOR];
  if (sessionMinutes === null && estimate <= WHOLE_UP_TO) return [estimate];
  const size = sessionMinutes ?? DEFAULT_SESSION;
  if (estimate <= size) return [estimate];
  const out: number[] = [];
  let left = estimate;
  while (left > 0) {
    if (left <= size) {
      // A small remainder joins the session before it rather than standing alone.
      if (left < SESSION_FLOOR && out.length) out[out.length - 1] += left;
      else out.push(left);
      break;
    }
    out.push(size);
    left -= size;
  }
  return out;
}

/**
 * Lays sessions into slots, earliest first. A session longer than the slot it reaches takes
 * the whole slot and carries the rest into the next; a piece under the floor is not placed.
 *
 * `gap` is the break a task takes between two of its own sessions. It only falls between two
 * spans laid inside the same slot: never before the first span of a placement, and never when
 * a session moves on to a new slot, where the meeting or session in between is break enough.
 * The break is not reserved for the task — it is simply time this placement did not take, and
 * the next task placed, or a session dragged there by hand, may sit in it.
 */
export function placeSessions(slots: Span[], sessions: number[], opts: { snap?: number; floor?: number; gap?: number }): { placed: Span[]; leftover: number } {
  const floor = opts.floor ?? SESSION_FLOOR;
  const snap = opts.snap ?? SNAP;
  const gap = opts.gap ?? 0;
  const placed: Span[] = [];
  let leftover = 0;
  let slotIndex = 0;
  let cursor = slots[0]?.start ?? 0;
  /** The slot the span before this one was laid in; -1 while no span has been laid in the slot in hand. */
  let lastSlot = -1;
  for (const wanted of sessions) {
    let need = wanted;
    while (need > 0) {
      const slot = slots[slotIndex];
      if (!slot) {
        leftover += need;
        break;
      }
      // Starts sit on the five-minute grid, so a meeting ending at 10:07 gives a session at 10:10.
      // The break is counted before the grid, so the session after it also starts on a five.
      const from = slotIndex === lastSlot ? cursor + gap : cursor;
      const start = up(Math.max(from, slot.start), snap);
      // What is left of the slot once the break has been taken out: a slot with room for the
      // session but not for the break before it is passed over, the same as any other short one.
      const room = Math.floor((slot.end - start) / snap) * snap;
      if (room < floor) {
        slotIndex += 1;
        cursor = slots[slotIndex]?.start ?? 0;
        lastSlot = -1;
        continue;
      }
      const take = Math.min(need, room);
      placed.push({ start, end: start + take });
      need -= take;
      cursor = start + take;
      lastSlot = slotIndex;
      // A tail shorter than the floor is not worth a session of its own: it stays unplaced.
      if (need > 0 && need < floor) {
        leftover += need;
        need = 0;
      }
      if (cursor >= slot.end - snap + 1) {
        slotIndex += 1;
        cursor = slots[slotIndex]?.start ?? 0;
        lastSlot = -1;
      }
    }
  }
  return { placed, leftover };
}
