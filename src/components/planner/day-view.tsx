"use client";

import type { PlannerDayDTO } from "@/lib/dto";
import { PlanPane } from "./plan-pane";
import { Timeline } from "./timeline";

export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[3fr_2fr] gap-6 items-start">
      <Timeline date={day.date} meetings={day.meetings} />
      <PlanPane day={day} today={today} onRefresh={onRefresh} />
    </div>
  );
}
