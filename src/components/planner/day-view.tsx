"use client";

import { useEffect } from "react";
import type { PlannerDayDTO } from "@/lib/dto";
import { PlanPane } from "./plan-pane";
import { Timeline } from "./timeline";

/**
 * Two columns from 1100 px: the timeline on the left, the plan on the right. Below that they
 * stack with the plan first: a phone plans, it does not read a timeline. The plan is written
 * first at every width, so tabbing reaches the day's real work before the calendar beside it.
 */
export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  // ⌘/ goes straight to the field that feeds the plan.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sb:plan-picker", { detail: { focus: true } }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1fr_1fr] min-[1400px]:grid-cols-[5fr_4fr] gap-6 items-start">
      <div className="min-[1100px]:order-2">
        <PlanPane day={day} today={today} onRefresh={onRefresh} />
      </div>
      <div className="min-[1100px]:order-1">
        <Timeline date={day.date} meetings={day.meetings} workHours={day.capacity.workHours} />
      </div>
    </div>
  );
}
