/** The drag type a plan row carries: the list reorders on it, the timeline places a block on it. */
export const PLAN_DRAG_MIME = "application/x-sb-plan";

/**
 * How long the dragged task's block will be, carried in the type rather than in the data.
 *
 * Through a `dragover` the drag data store is protected: `getData` answers "" for everything,
 * and only `types` can be read. So the length is spelled into a second type the row sets
 * alongside `PLAN_DRAG_MIME`, and the timeline reads it back off the list to size its ghost.
 */
const PLAN_MINUTES_RE = /^application\/x-sb-plan-minutes-(\d+)$/;

export function planMinutesType(minutes: number): string {
  return `application/x-sb-plan-minutes-${Math.max(0, Math.round(minutes))}`;
}

/** The minutes a drag declared, or null when it carries none — a drag from somewhere else. */
export function readPlanMinutes(types: readonly string[]): number | null {
  for (const type of types) {
    const m = PLAN_MINUTES_RE.exec(type);
    if (m) {
      const minutes = Number(m[1]);
      if (minutes > 0) return minutes;
    }
  }
  return null;
}
