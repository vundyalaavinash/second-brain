import type { TaskDTO } from "@/lib/dto";
import { daysBetween } from "@/lib/deadline";

/** How far back "what moved" looks. A week is the unit people review their own work in. */
export const MOVED_DAYS = 7;

export interface ProjectPulse {
  open: number;
  /** Open tasks whose due date has passed. The list is ordered by hand, so these can sit anywhere. */
  overdue: number;
  /** Open tasks with no estimate -- the part of the project that cannot be forecast at all. */
  unestimated: number;
  estimatedMinutes: number;
  spentMinutes: number;
  /** Closed in the last `MOVED_DAYS`, from `completedAt`. */
  closedRecently: number;
}

/**
 * What a project looks like right now, from the tasks the page already holds.
 *
 * Every field here was already in props and summed nowhere: each task carries its estimate, what
 * has been spent on it, when it was closed and when it is due, and the page rendered them one row
 * at a time. A project is run on the aggregate -- is this thing forecastable, is it slipping, did
 * anything move this week -- and none of that was on screen.
 *
 * Estimated and spent deliberately count *all* tasks, not just the open ones: a project's cost is
 * what it has taken, and dropping the closed ones would make "spent" shrink as work finished.
 */
export function projectPulse(tasks: TaskDTO[], today: string): ProjectPulse {
  let open = 0;
  let overdue = 0;
  let unestimated = 0;
  let estimatedMinutes = 0;
  let spentMinutes = 0;
  let closedRecently = 0;

  for (const task of tasks) {
    estimatedMinutes += task.estimateMinutes ?? 0;
    spentMinutes += task.spentMinutes;

    if (task.status === "open") {
      open += 1;
      if (task.estimateMinutes === null) unestimated += 1;
      // Due today is not overdue: the day is not over.
      if (task.dueDate && daysBetween(today, task.dueDate) < 0) overdue += 1;
      continue;
    }
    if (task.status === "done" && task.completedAt && daysBetween(task.completedAt.slice(0, 10), today) < MOVED_DAYS) {
      closedRecently += 1;
    }
  }

  return { open, overdue, unestimated, estimatedMinutes, spentMinutes, closedRecently };
}

/** Nothing worth a strip: no tasks at all, and so nothing measured. */
export function hasPulse(pulse: ProjectPulse): boolean {
  return pulse.open > 0 || pulse.closedRecently > 0 || pulse.spentMinutes > 0 || pulse.estimatedMinutes > 0;
}
