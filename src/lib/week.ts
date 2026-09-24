import { addDaysLocal } from "@/components/activity/format";

/**
 * No imports of its own beyond `addDaysLocal` — plain date arithmetic, exactly like `localDay`
 * in `./time`, because both the Planner's server page and the Activity client component need
 * the same Monday rule and neither can afford to pull in the domain to get it.
 */
const MONTHS = [
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

/** The Monday on or before `day`. Sunday counts as the week's last day, not the next week's first. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return addDaysLocal(day, -((dow + 6) % 7));
}

/** The Sunday that closes the week beginning on `start`. */
export function weekEnd(start: string): string {
  return addDaysLocal(start, 6);
}

/** The week's seven days, Monday through Sunday. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysLocal(start, i));
}

/** The following week's Monday. */
export function nextWeek(start: string): string {
  return addDaysLocal(start, 7);
}

/** "Week of 21 September". */
export function weekLabel(start: string): string {
  const [, m, d] = start.split("-").map(Number);
  return `Week of ${d} ${MONTHS[m - 1]}`;
}
