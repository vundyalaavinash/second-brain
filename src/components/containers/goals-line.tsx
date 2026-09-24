"use client";

import Link from "next/link";
import type { GoalRefDTO } from "@/lib/dto";

/**
 * "Serves Launch v2" under a project or area's name, each name a link to its goal. Renders
 * nothing at all when the container serves no active goal — no empty line, no placeholder.
 */
export function GoalsLine({ goals }: { goals: GoalRefDTO[] }) {
  if (goals.length === 0) return null;
  return (
    <p className="text-[13px] text-fg-faint m-0 flex flex-wrap items-baseline gap-x-1">
      <span>Serves</span>
      {goals.map((goal, i) => (
        <span key={goal.id}>
          <Link href={`/goals/${goal.id}`} className="focus-ring rounded-sm hover:text-violet-bright">
            {goal.title}
          </Link>
          {i < goals.length - 1 && ","}
        </span>
      ))}
    </p>
  );
}
