import { blockLength } from "@/lib/capacity";

export const SNAP_MINUTES = 5;

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
}

/** A local timestamp for `minutesOfDay` on `date`; minutes past midnight roll into the next day. */
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
