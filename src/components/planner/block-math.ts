export const SNAP_MINUTES = 5;

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
}

/**
 * A local timestamp for `minutesOfDay` on `date`; minutes past midnight roll into the next day.
 *
 * The answer is whatever the local calendar makes of it, so on the two days a year the clocks
 * move it is not always the minute that was asked for: a time that does not exist on a
 * spring-forward day normalises forward past the gap, and one that happens twice on a
 * fall-back day resolves to the first of the two.
 */
export function minutesToIso(date: string, minutesOfDay: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return stamp(new Date(y, m - 1, d, 0, minutesOfDay, 0, 0));
}

export function isoToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** A task's first session on the day, the one the column and the row's chip speak for. */
export function firstBlock<T extends { startsAt: string }>(task: { blocks: T[] }, date: string): T | undefined {
  return task.blocks.find((b) => b.startsAt.startsWith(date));
}

/** Where a session ends, from its start and its length. */
export function blockEnd(block: { startsAt: string; minutes: number }): string {
  return stamp(new Date(new Date(block.startsAt).getTime() + block.minutes * 60_000));
}
