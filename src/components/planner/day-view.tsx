"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { Button } from "../ui";
import { useMediaQuery } from "../shell/use-media-query";
import { PlanPane } from "./plan-pane";
import { SourcesDrawer } from "./sources-drawer";
import { Timeline } from "./timeline";

const SOURCES_REGION = "sources-region";
/** From this width the sources float over the right edge; below it they stack under the plan. */
const OVERLAY_QUERY = "(min-width: 1100px)";
/** Whether the slide-over was left open, per browser. */
const OPEN_KEY = "sb:planner-sources-open";
/** Escape belongs to whatever is being typed in or chosen from first. */
const TYPING = 'input, textarea, [contenteditable="true"], [role="menu"]';

const REGION_CLOSED = "block min-[1100px]:hidden";
/** Open, the sources slide over the right edge from 1100 px up; below that they sit under the plan. */
const REGION_OPEN =
  "block min-[1100px]:fixed min-[1100px]:inset-y-0 min-[1100px]:right-0 min-[1100px]:z-40 min-[1100px]:w-[min(440px,100vw)] min-[1100px]:p-4 min-[1100px]:overflow-y-auto min-[1100px]:bg-carbon/95 min-[1100px]:border-l min-[1100px]:border-hairline min-[1100px]:shadow-[-24px_0_48px_-32px_rgba(0,0,0,.8)]";

/**
 * Two columns: the timeline on the left, the plan on the right, and the sources as a slide-over
 * the plan opens when it needs them. Below 1100 px the regions stack, sources collapsed behind
 * their own heading: a phone plans, it does not read a timeline. The plan is written first at
 * every width, so tabbing reaches the day's real work before anything else; only the painting
 * puts the timeline on the left from 1100 px up.
 */
export function DayView({ day, today, onRefresh }: { day: PlannerDayDTO; today: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  // Bumped by a drawer key that has nothing to toggle, so the effect below lands the focus
  // once the region it asked for is on the page.
  const [focusRequest, setFocusRequest] = useState(0);
  const regionRef = useRef<HTMLDivElement | null>(null);
  // Only the floating form is a dialog; in the stack it is a plain region.
  const floating = useMediaQuery(OVERLAY_QUERY);
  const overlay = open && floating;

  // A slide-over left open stays open next time; the read waits for the client so the first
  // render matches the server's.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") queueMicrotask(() => setOpen(true));
    } catch {
      /* no storage: it just starts closed */
    }
  }, []);
  function setOpenRemembered(next: boolean | ((v: boolean) => boolean)) {
    const value = typeof next === "function" ? next(open) : next;
    setOpen(value);
    try {
      localStorage.setItem(OPEN_KEY, value ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        // Floating, the key is a toggle and the open effect takes the focus. Stacked, the
        // sources are one heading away, so it only shows them and moves into them.
        if (floating) setOpenRemembered((v) => !v);
        else {
          setOpenRemembered(true);
          setFocusRequest((n) => n + 1);
        }
        return;
      }
      if (e.key !== "Escape" || !open) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      setOpenRemembered(false);
    }
    function onDrawer(e: Event) {
      const detail = (e as CustomEvent<{ toggle?: boolean; tab?: string }>).detail ?? {};
      if (detail.toggle) setOpenRemembered((v) => !v);
      else if (detail.tab) setOpenRemembered(true);
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
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[1fr_1fr] min-[1400px]:grid-cols-[5fr_4fr] gap-6 items-start">
      <div className="min-[1100px]:order-2 flex flex-col gap-3">
        <div className="hidden min-[1100px]:flex justify-end">
          <Button size="sm" icon={Plus} aria-expanded={open} aria-controls={SOURCES_REGION} onClick={() => setOpenRemembered((v) => !v)}>
            {open ? "Hide sources" : "Add tasks"}
          </Button>
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
          onClick={() => setOpenRemembered((v) => !v)}
        >
          Sources
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <div id={SOURCES_REGION} className={open ? "min-[1100px]:mt-0 mt-3" : "hidden"}>
          <SourcesDrawer day={day} today={today} />
        </div>
      </div>
    </div>
  );
}
