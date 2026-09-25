"use client";

import { formatMinutes } from "@/lib/capacity";
import { Button } from "../ui";
import type { TaskDTO } from "@/lib/dto";

interface Props {
  status: TaskDTO["status"];
  estimateMinutes: number | null;
  likeThisMinutes: number | null;
  onEstimate: (minutes: number) => void;
}

/**
 * Whether `EstimateHint` has anything to show — `task-row.tsx` reads this too, so the row's own
 * layout can skip the hint's wrapper entirely rather than render an empty one that still shifts
 * spacing: a row with nothing to offer must look byte-identical to one that never had this field
 * at all. `likeThisMinutes` is already null below three matches or with no container
 * (`src/domain/focus/index.ts`'s `likeThisMinutesByTask`), so this only adds the two conditions
 * that are the hint's own to judge: open, and no guess of its own yet.
 */
export function hasEstimateHint({ status, estimateMinutes, likeThisMinutes }: Pick<Props, "status" | "estimateMinutes" | "likeThisMinutes">): boolean {
  return status === "open" && estimateMinutes === null && likeThisMinutes !== null;
}

/**
 * The outside view for one task: what finished work like it actually cost, offered only where a
 * guess is still missing and there is enough of that work to trust. Nothing renders otherwise —
 * no placeholder, no "0m" — because a wrong hint in front of an unestimated task is worse than
 * no hint at all (design's own words); this component only ever gets to that judgment through
 * `hasEstimateHint`, so the two can never disagree about when there is something to say.
 */
export function EstimateHint({ status, estimateMinutes, likeThisMinutes, onEstimate }: Props) {
  if (!hasEstimateHint({ status, estimateMinutes, likeThisMinutes })) return null;
  const minutes = formatMinutes(likeThisMinutes!);
  return (
    <span className="flex items-center gap-2 flex-wrap text-[11.5px] text-fg-faint">
      <span>Tasks like this have taken about {minutes}</span>
      <Button variant="ghost" size="sm" onClick={() => onEstimate(likeThisMinutes!)} className="h-5 px-1.5 text-[11px]">
        Use {minutes} as the estimate
      </Button>
    </span>
  );
}
