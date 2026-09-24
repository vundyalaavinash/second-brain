import { parseWorkHours } from "./capacity";

export type Span = { start: number; end: number };
export const SESSION_FLOOR = 15;
export const DEFAULT_SESSION = 45;
export const WHOLE_UP_TO = 60;
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
 */
export function placeSessions(slots: Span[], sessions: number[], opts: { snap?: number; floor?: number }): { placed: Span[]; leftover: number } {
  const floor = opts.floor ?? SESSION_FLOOR;
  const snap = opts.snap ?? SNAP;
  const placed: Span[] = [];
  let leftover = 0;
  let slotIndex = 0;
  let cursor = slots[0]?.start ?? 0;
  for (const wanted of sessions) {
    let need = wanted;
    while (need > 0) {
      const slot = slots[slotIndex];
      if (!slot) {
        leftover += need;
        break;
      }
      const start = Math.max(cursor, slot.start);
      const room = Math.floor((slot.end - start) / snap) * snap;
      if (room < floor) {
        slotIndex += 1;
        cursor = slots[slotIndex]?.start ?? 0;
        continue;
      }
      const take = Math.min(need, room);
      if (take < floor && need - take > 0 && need - take < floor) {
        // Neither the piece here nor what would remain is worth a session on its own.
        leftover += need;
        break;
      }
      placed.push({ start, end: start + take });
      need -= take;
      cursor = start + take;
      if (cursor >= slot.end - snap + 1) {
        slotIndex += 1;
        cursor = slots[slotIndex]?.start ?? 0;
      }
    }
  }
  return { placed, leftover };
}
