import { formatMinutes } from "@/lib/capacity";
import { addDaysLocal } from "../activity/format";
import { formatShortDate } from "../tasks/task-row";
import { count } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };

/** What every write on the plan says when it could not be made. */
export const SAVE_ERROR = "Could not save that change";

/** What the toast's offer is called: the day after the one just placed, named unless that day
 * is simply tomorrow. */
export function placeNextLabel(date: string, today: string): string {
  return date === today ? "Place tomorrow" : `Place on ${formatShortDate(addDaysLocal(date, 1))}`;
}

/** The three ways a fill can go: nothing to do, everything placed, or a remainder left over. */
function placedText(placed: number, unplacedMinutes: number): string {
  if (placed === 0) return "Nothing to place";
  return unplacedMinutes > 0 ? `Placed ${count(placed, "session")}, ${formatMinutes(unplacedMinutes)} unplaced` : `Placed ${count(placed, "session")}`;
}

export interface PlaceDayOptions {
  /** One plan row's sessions; with no task it is the whole day's unplaced work. */
  taskId?: number | null;
  /** The day the app is being used on, so the offer can name the day it means. */
  today: string;
  /** Whether this run may offer the next day what the day had no room for. */
  offerNext?: boolean;
  /** Told the trouble, or told null when the run went through. */
  onError: (message: string | null) => void;
}

/**
 * Spec §3's Fill the day, said from wherever it is asked for: lays a task's sessions — or, with
 * no task, every unplaced plan task's — into the day's free slots, announces the change, and
 * raises the toast that says what happened. `offerNext` carries the way out: what the day had no
 * room for can go on the next one, which is the same run a day later.
 */
export async function placeDay(date: string, opts: PlaceDayOptions): Promise<void> {
  const { taskId = null, today, offerNext = false, onError } = opts;
  const body = taskId === null ? { date } : { date, taskId };
  const res = await fetch("/api/plan/place", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    onError(SAVE_ERROR);
    return;
  }
  // The sessions are written whatever comes back, so the day is read back before the answer is
  // unpacked: a body that cannot be read costs the toast, never the placement.
  window.dispatchEvent(new Event("sb:tasks-changed"));
  const answer = (await res.json().catch(() => null)) as { placed: number; unplacedMinutes: number } | null;
  if (!answer) {
    onError(SAVE_ERROR);
    return;
  }
  onError(null);
  const { placed, unplacedMinutes } = answer;
  // Only the first run offers the next day: a toast that offered it again would walk the work
  // off into a week nobody asked about.
  const action =
    offerNext && unplacedMinutes > 0 ? { label: placeNextLabel(date, today), onClick: () => void placeNextDay(date, taskId, today, onError) } : undefined;
  window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: placedText(placed, unplacedMinutes), action } }));
}

/** The toast's action: the next day has to hold the task before it can place it. A whole-day
 * fill plans nothing new — it places what that day already carries. The plan write says nothing
 * on its own; the place that follows announces the one change anyone needs to read back. */
async function placeNextDay(date: string, taskId: number | null, today: string, onError: (message: string | null) => void): Promise<void> {
  const next = addDaysLocal(date, 1);
  if (taskId !== null) {
    const res = await fetch("/api/plan", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ date: next, taskId }) });
    if (!res.ok) {
      onError(SAVE_ERROR);
      return;
    }
    onError(null);
  }
  await placeDay(next, { taskId, today, onError });
}
