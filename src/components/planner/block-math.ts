import { blockLength } from "@/lib/capacity";

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

export function blockEnd(task: { scheduledAt: string; estimateMinutes: number | null }): string {
  const start = new Date(task.scheduledAt);
  return stamp(new Date(start.getTime() + blockLength(task) * 60_000));
}
