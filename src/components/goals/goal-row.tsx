"use client";

import Link from "next/link";
import type { GoalDTO } from "@/lib/dto";
import { daysBetween, deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { Chip } from "../ui";
import { ProgressRing } from "../tasks/progress-ring";

/**
 * The local calendar day a close fell on, for the stalled duration below — the same local-day
 * reading the server uses (`localDay`) to compute the `stalled` flag itself, not the UTC day a
 * plain `slice(0, 10)` would give. East of UTC those disagree by a day for a close made in the
 * small hours, which is how the label and the flag it sits behind used to drift apart. The math
 * is repeated here rather than imported because `@/domain/activity` reaches server-only modules
 * this client component cannot pull into the browser bundle.
 */
function isoDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Movement leads the line: what closed recently, or — in plain words, no colour, no icon —
 * how long nothing has. Shared with goal-page.tsx so the two screens never disagree on wording. */
export function goalMovementLabel(measure: GoalDTO["measure"], today: string): string {
  if (!measure.stalled) return `${measure.movement} closed this week`;
  if (!measure.lastClosedAt) return "Nothing closed on this yet";
  const days = daysBetween(isoDay(measure.lastClosedAt), today);
  return `Nothing closed on this in ${days} day${days === 1 ? "" : "s"}`;
}

export function GoalRow({ goal, today }: { goal: GoalDTO; today: string }) {
  const due = deadlineLabel(goal.targetDate, today);
  const stalled = goal.measure.stalled;
  return (
    <li className="hairline-row flex flex-col gap-1.5 py-3 px-1">
      <Link href={`/goals/${goal.id}`} className="focus-ring rounded-sm text-[14.5px] font-medium hover:text-violet-bright">
        {goal.title}
      </Link>
      {goal.outcome && <p className="text-[13px] text-fg-muted m-0">{goal.outcome}</p>}
      {/* Movement leads, in words; progress is the small ring behind it, never the loudest
        * thing in the row. */}
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className={stalled ? "text-fg-faint" : "text-fg-muted"}>{goalMovementLabel(goal.measure, today)}</span>
        <span className="text-fg-faint">·</span>
        {/* The figure is right there in words beside it, so the ring is decoration: left in
          * the tree it would have a reader say the percent twice. */}
        <span aria-hidden>
          <ProgressRing percent={goal.measure.percent} size={16} stroke={2} />
        </span>
        <span className="font-mono text-fg-muted">{goal.measure.percent}%</span>
        {goal.containers.map((c) => (
          <Chip key={c.id} href={`/c/${c.slug}`} className="h-5 px-1.5 text-[11px]">
            {c.name}
          </Chip>
        ))}
        <span className="flex-1" />
        <span className={TONE_CLASS[due.tone]}>{due.text}</span>
      </div>
    </li>
  );
}
