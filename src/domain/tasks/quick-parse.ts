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

/** `~25m`, `~1h`, `~1h30m`: one token, anywhere, at most 8 hours. Priority marks (`!`) must
 * already be stripped: the token has to end at a space or the end of the text. */
const ESTIMATE_RE = /(?:^|\s)~(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?=\s|$)/i;

export function estimateFromToken(text: string): { title: string; estimateMinutes: number | null } {
  const m = text.match(ESTIMATE_RE);
  if (!m || (m[1] === undefined && m[2] === undefined)) return { title: text, estimateMinutes: null };
  const minutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  if (minutes < 5 || minutes > 480) return { title: text, estimateMinutes: null };
  const title = (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
  return { title, estimateMinutes: minutes };
}

/** Parse "! Title fri" style shortcuts from an add-task input. Pure; `now` is injectable. */
export function quickParse(
  input: string,
  now: Date = new Date(),
): { title: string; priority: "high" | "normal"; dueDate: string | null; estimateMinutes: number | null } {
  let title = input.trim();
  let priority: "high" | "normal" = "normal";
  if (title.startsWith("!")) {
    priority = "high";
    title = title.slice(1).trim();
  } else if (title.endsWith("!")) {
    priority = "high";
    title = title.slice(0, -1).trim();
  }
  const est = estimateFromToken(title);
  title = est.title;
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
  return { title: title.trim(), priority, dueDate, estimateMinutes: est.estimateMinutes };
}
