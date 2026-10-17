"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, HelpCircle } from "lucide-react";
import type { TaskDTO } from "@/lib/dto";
import { formatMinutes } from "@/lib/capacity";
import { MOVED_DAYS, hasPulse, projectPulse } from "@/lib/project-pulse";

/**
 * One line of what this project looks like right now.
 *
 * Everything here was already in the page's props and summed nowhere: each task carried its
 * estimate, its spend, when it closed and when it is due, and they were rendered one row at a
 * time. A project is run on the aggregate, so this is the aggregate -- and it costs no new query.
 *
 * Icons rather than labels because the row has to survive on a narrow screen beside the deadline
 * chip; each one keeps a worded title, which is also what a screen reader reads.
 */
export function ProjectPulse({ tasks, today }: { tasks: TaskDTO[]; today: string }) {
  const pulse = projectPulse(tasks, today);
  if (!hasPulse(pulse)) return null;

  // Shown only when it says something: a project with nothing overdue should not carry a zero
  // next to a warning triangle, which reads as a problem at a glance.
  const over = pulse.spentMinutes > pulse.estimatedMinutes && pulse.estimatedMinutes > 0;

  return (
    // `role="group"`, not a bare div: a set of related readings needs a role for its label to be
    // exposed at all, and this is a group of them rather than a list or a status.
    <div role="group" className="flex items-center gap-3 flex-wrap text-[12px] text-fg-muted" aria-label="Project pulse">
      <span className="flex items-center gap-1" title={`${pulse.open} open`}>
        <CircleDashed className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {pulse.open} open
      </span>

      {pulse.overdue > 0 && (
        <span className="flex items-center gap-1 text-danger" title={`${pulse.overdue} overdue`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {pulse.overdue} overdue
        </span>
      )}

      {pulse.unestimated > 0 && (
        <span className="flex items-center gap-1" title={`${pulse.unestimated} with no estimate, so this project cannot be forecast yet`}>
          <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {pulse.unestimated} unestimated
        </span>
      )}

      {(pulse.estimatedMinutes > 0 || pulse.spentMinutes > 0) && (
        <span
          className={`flex items-center gap-1 ${over ? "text-warn" : ""}`}
          title={`${formatMinutes(pulse.spentMinutes)} spent against ${formatMinutes(pulse.estimatedMinutes)} estimated`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {formatMinutes(pulse.spentMinutes)} / {formatMinutes(pulse.estimatedMinutes)}
        </span>
      )}

      {pulse.closedRecently > 0 && (
        <span className="flex items-center gap-1 text-success" title={`${pulse.closedRecently} closed in the last ${MOVED_DAYS} days`}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {pulse.closedRecently} closed this week
        </span>
      )}
    </div>
  );
}
