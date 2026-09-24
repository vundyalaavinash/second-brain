export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The local calendar day an instant falls on, as `YYYY-MM-DD`. It lives here, with no imports
 * of its own, because both sides need it: the domain reads stored UTC instants as local days,
 * and client components label those same instants. A `slice(0, 10)` gives the UTC day instead,
 * which east of UTC is a different day for anything in the small hours.
 */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
