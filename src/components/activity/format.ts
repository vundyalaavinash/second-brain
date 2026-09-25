export function todayLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Position of an ISO instant within a local day as a fraction 0..1. */
export function fractionOfDay(iso: string, day: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  const start = new Date(y, mo - 1, d).getTime();
  return Math.min(1, Math.max(0, (Date.parse(iso) - start) / 86_400_000));
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDayHeading(day: string): string {
  const [y, m, dNum] = day.split("-").map(Number);
  const d = new Date(y, m - 1, dNum);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "3 October" from an ISO instant's own UTC calendar date -- never the local one. Audio-release
 * stamps (`audioReleasedAt`, `nextReleaseAt`) are written in UTC (see `backupDateStamp`'s own
 * doc comment for why), so this reads the same day regardless of the machine's timezone rather
 * than risking a shift across midnight under an odd zone -- no `Date` construction at all, just
 * the digits already in the string, the same trick `formatRecoveryDate` in `safety-line.tsx` uses
 * for a bare `YYYY-MM-DD`. */
export function formatUtcDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function addDaysLocal(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayLocal(new Date(y, m - 1, d + n));
}

/** "just now", "4 min ago", "2 h ago", else the date: enough to trust or doubt a sync. */
export function sinceLabel(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
