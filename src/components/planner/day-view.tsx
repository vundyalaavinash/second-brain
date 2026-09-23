"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, PanelRight } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { IconButton } from "../ui";
import { useMediaQuery } from "../shell/use-media-query";
import { PlanPane } from "./plan-pane";
import { SourcesDrawer } from "./sources-drawer";
import { Timeline } from "./timeline";

const SOURCES_REGION = "sources-region";
/** The widths where an open drawer floats over the page rather than sitting in the grid. */
const OVERLAY_QUERY = "(min-width: 1100px) and (max-width: 1279px)";
/** Escape belongs to whatever is being typed in or chosen from first. */
const TYPING = 'input, textarea, [contenteditable="true"], [role="menu"]';

const REGION_CLOSED = "min-[1100px]:order-3 block min-[1100px]:hidden min-[1280px]:block";
/** Open, the drawer floats over the right edge from 1100 px; from 1280 px it is the third column again. */
const REGION_OPEN =
  "min-[1100px]:order-3 block min-[1100px]:fixed min-[1100px]:inset-y-0 min-[1100px]:right-0 min-[1100px]:z-40 min-[1100px]:w-[min(420px,100vw)] min-[1100px]:p-4 min-[1100px]:overflow-y-auto min-[1100px]:bg-carbon/95 min-[1100px]:border-l min-[1100px]:border-hairline " +
  "min-[1280px]:static min-[1280px]:inset-auto min-[1280px]:w-auto min-[1280px]:p-0 min-[1280px]:overflow-visible min-[1280px]:bg-transparent min-[1280px]:border-0";

/**
 * Timeline, plan, sources, in one grid and with one drawer in it. Above 1280 px the drawer has
 * its own column; between 1100 and 1280 it opens over the right edge from a toggle; below that
 * the regions stack, collapsed behind its own heading: a phone plans, it does not read a
 * timeline. The plan is written first at every width, so tabbing reaches the day's real work
 * before anything else; only the painting swaps the timeline to the left from 1100 px up.
 */
export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  // Bumped by a drawer key that has nothing to toggle, so the effect below lands the focus
  // once the region it asked for is on the page.
  const [focusRequest, setFocusRequest] = useState(0);
  const regionRef = useRef<HTMLDivElement | null>(null);
  // Only the floating form is a dialog; in the grid or in the stack it is a plain region.
  const floating = useMediaQuery(OVERLAY_QUERY);
  const overlay = open && floating;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        // Floating, the key is a toggle and the open effect takes the focus. Everywhere else
        // the sources are already on the page (or one heading away), so it only shows them
        // and moves into them.
        if (floating) setOpen((v) => !v);
        else {
          setOpen(true);
          setFocusRequest((n) => n + 1);
        }
        return;
      }
      if (e.key !== "Escape" || !open) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      setOpen(false);
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
  }, [open, floating]);

  // Opening the floating form hands over the keyboard: the tab already chosen takes focus.
  useEffect(() => {
    if (!overlay) return;
    regionRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [overlay]);

  // The same move for a drawer that never floated: the region has rendered by now.
  useEffect(() => {
    if (focusRequest === 0) return;
    regionRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusRequest]);

  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[3fr_2fr] min-[1280px]:grid-cols-[5fr_4fr_4fr] gap-6 items-start">
      <div className="min-[1100px]:order-2 flex flex-col gap-3">
        <div className="hidden min-[1100px]:flex min-[1280px]:hidden justify-end">
          <IconButton label={open ? "Hide sources" : "Show sources"} icon={PanelRight} active={open} onClick={() => setOpen((v) => !v)} />
        </div>
        <PlanPane day={day} today={today} onRefresh={onRefresh} />
      </div>
      <div className="min-[1100px]:order-1">
        <Timeline date={day.date} meetings={day.meetings} workHours={day.capacity.workHours} />
      </div>
      <div
        ref={regionRef}
        className={open ? REGION_OPEN : REGION_CLOSED}
        {...(overlay ? { role: "dialog", "aria-modal": true, "aria-label": "Sources" } : {})}
      >
        <button
          type="button"
          className="focus-ring min-[1100px]:hidden w-full flex items-center justify-between rounded-md border border-hairline bg-layer-1 px-3 h-9 text-[13px] text-fg-muted hover:text-fg transition-colors duration-150"
          aria-expanded={open}
          aria-controls={SOURCES_REGION}
          onClick={() => setOpen((v) => !v)}
        >
          Sources
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <div id={SOURCES_REGION} className={open ? "min-[1100px]:mt-0 mt-3" : "hidden min-[1280px]:block"}>
          <SourcesDrawer day={day} today={today} />
        </div>
      </div>
    </div>
  );
}
