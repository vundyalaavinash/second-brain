"use client";

import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { IconButton } from "../ui";
import { PlanPane } from "./plan-pane";
import { SourcesDrawer } from "./sources-drawer";
import { Timeline } from "./timeline";

/**
 * Timeline, plan, sources. Above 1280 px the drawer has its own column; between 1100 and 1280
 * it opens over the right edge from a toggle; below that the regions stack with the drawer
 * last, plan first: a phone plans, it does not read a timeline.
 */
export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
    }
    function onDrawer(e: Event) {
      const detail = (e as CustomEvent<{ toggle?: boolean; tab?: string }>).detail ?? {};
      if (detail.toggle) setOpen((v) => !v);
      else if (detail.tab) setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("sb:planner-drawer", onDrawer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sb:planner-drawer", onDrawer);
    };
  }, []);

  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[3fr_2fr] min-[1280px]:grid-cols-[5fr_4fr_4fr] gap-6 items-start">
      <div className="order-2 min-[1100px]:order-1">
        <Timeline date={day.date} meetings={day.meetings} />
      </div>
      <div className="order-1 min-[1100px]:order-2 flex flex-col gap-3">
        <div className="min-[1280px]:hidden flex justify-end">
          <IconButton label={open ? "Hide sources" : "Show sources"} icon={PanelRight} active={open} onClick={() => setOpen((v) => !v)} />
        </div>
        <PlanPane day={day} today={today} onRefresh={onRefresh} />
      </div>
      <div className="order-3 hidden min-[1280px]:block">
        <SourcesDrawer day={day} today={today} onRefresh={onRefresh} />
      </div>
      {open && (
        <div
          className="min-[1280px]:hidden fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] p-4 overflow-y-auto bg-carbon/95 border-l border-hairline"
          role="dialog"
          aria-label="Sources"
        >
          <SourcesDrawer day={day} today={today} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
