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

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDayHeading(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function addDaysLocal(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayLocal(new Date(y, m - 1, d + n));
}
