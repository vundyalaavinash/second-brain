function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((localDate(b).getTime() - localDate(a).getTime()) / 86_400_000);
}

export type DeadlineTone = "muted" | "warn" | "danger" | "faint";

export function deadlineLabel(deadline: string | null, today: string): { text: string; tone: DeadlineTone } {
  if (!deadline) return { text: "No deadline", tone: "faint" };
  const days = daysBetween(today, deadline);
  if (days === 0) return { text: "Due today", tone: "warn" };
  if (days > 0) return { text: `${days} day${days === 1 ? "" : "s"} left`, tone: "muted" };
  const over = -days;
  return { text: `${over} day${over === 1 ? "" : "s"} overdue`, tone: "danger" };
}

export function sortProjects<T extends { deadline: string | null; name: string }>(list: T[], today: string): T[] {
  const rank = (p: T) => (p.deadline ? (daysBetween(today, p.deadline) < 0 ? 0 : 1) : 2);
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
