const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateFromToken(token: string, now: Date): string | null {
  const t = token.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === "today") return localDay(now);
  if (t === "tomorrow") return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const idx = WEEKDAYS.findIndex((w) => w === t || w.slice(0, 3) === t);
  if (idx === -1) return null;
  const delta = (idx - now.getDay() + 7) % 7; // today counts when it is that weekday
  return localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta));
}

/** Parse "! Title fri" style shortcuts from an add-task input. Pure; `now` is injectable. */
export function quickParse(input: string, now: Date = new Date()): { title: string; priority: "high" | "normal"; dueDate: string | null } {
  let title = input.trim();
  let priority: "high" | "normal" = "normal";
  if (title.startsWith("!")) {
    priority = "high";
    title = title.slice(1).trim();
  } else if (title.endsWith("!")) {
    priority = "high";
    title = title.slice(0, -1).trim();
  }
  let dueDate: string | null = null;
  const words = title.split(/\s+/);
  if (words.length > 1) {
    const last = words[words.length - 1];
    const parsed = dateFromToken(last, now);
    if (parsed) {
      dueDate = parsed;
      words.pop();
      title = words.join(" ");
      if (title.endsWith("!")) {
        priority = "high";
        title = title.slice(0, -1).trim();
      }
    }
  }
  return { title: title.trim(), priority, dueDate };
}
