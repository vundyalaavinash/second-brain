import { isProbablyUrl } from "./text";
import { quickParse } from "@/domain/tasks/quick-parse";

export type Intent =
  | { kind: "note"; body: string }
  | { kind: "link"; url: string }
  | { kind: "task"; title: string; priority: "high" | "normal"; dueDate: string | null }
  | { kind: "search"; query: string };

/** What a line typed into the prompt bar means. Pure; `now` is injectable for the date words. */
export function detectIntent(raw: string, now: Date = new Date()): Intent {
  const text = raw.trim();
  if (text.startsWith("/note ")) return { kind: "note", body: text.slice(6).trim() };
  if (text.startsWith("/search ")) return { kind: "search", query: text.slice(8).trim() };
  if (text.startsWith("?")) return { kind: "search", query: text.slice(1).trim() };
  if (text.startsWith("/task ") || text.startsWith("+")) {
    const parsed = quickParse(text.replace(/^\/task\s+|^\+\s*/, ""), now);
    return { kind: "task", title: parsed.title, priority: parsed.priority, dueDate: parsed.dueDate };
  }
  if (isProbablyUrl(text)) return { kind: "link", url: text };
  return { kind: "note", body: text };
}
