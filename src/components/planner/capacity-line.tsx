"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CapacityDTO } from "@/lib/dto";
import { formatMinutes, parseWorkHours } from "@/lib/capacity";
import { count } from "./open-meeting";

interface Props {
  capacity: CapacityDTO;
  meetings: number;
  onHours: (workHours: string) => void;
  /** Spec §5: one page, one region that speaks up. Home's Now owns that role, so the line it
   * sits above reads as plain text there rather than announcing the day twice. */
  quiet?: boolean;
}

/** A coarse "about Nh" for the overrun sentence — the middle figure (or, with no forecast, the
 * plain planned figure) already gave the precise cost, so the alarm only needs to be close
 * enough to feel. `Math.floor`, never `Math.round`: an overrun this states is real, so it is
 * never rounded up past what it actually is. Under a full hour it falls back to `formatMinutes`
 * rather than saying "0h". */
function roughHours(n: number): string {
  const hours = Math.floor(n / 60);
  return hours >= 1 ? `${hours}h` : formatMinutes(n);
}

/**
 * The Day header's mono line: what is planned, what it will really cost at this person's own
 * pace, and what the day still has room for — with a chip to say what the working hours are.
 *
 * Spec §4.2: three figures, in that order, and the middle one is the point. When the day will
 * not hold it, the line says so in a sentence rather than a colour — there is no tone here to
 * read, because words carry the alarm a swatch used to. Below `DRIFT_MIN_PAIRS` finished tasks
 * there is no pace to forecast from, so the middle figure is dropped and a line inside the same
 * region says why — but the overrun sentence still fires, against the plan itself rather than a
 * forecast, because "planned vs. what is left" is arithmetic on two numbers already in hand, not
 * a guess: overcommitment has to be visible before drift exists to measure it (spec §2).
 */
export function CapacityLine({ capacity, meetings, onHours, quiet = false }: Props) {
  const { plannedMinutes, forecastMinutes, leftTodayMinutes, drift, unestimated, blockedMinutes, unplacedMinutes } = capacity;
  // The two guards share one condition, so a slipped invariant can never drop both the figure
  // and its explanation, or show neither (F9): with a forecast, the forecast is the real cost;
  // without one, the plan is the best figure there is.
  const hasForecast = drift !== null && forecastMinutes !== null;
  const overBasis = hasForecast ? forecastMinutes! : plannedMinutes;
  const over = overBasis > leftTodayMinutes ? overBasis - leftTodayMinutes : 0;
  return (
    <span className="flex items-start gap-3 flex-wrap justify-end">
      <span role={quiet ? undefined : "status"} className="flex flex-col items-end gap-0.5 min-w-0">
        <span className="font-mono text-[12px] text-fg-muted">
          {formatMinutes(plannedMinutes)} planned
          {hasForecast && <> · about {formatMinutes(forecastMinutes!)} at your pace</>}
          {" · "}
          {formatMinutes(leftTodayMinutes)} left today
          {unestimated > 0 && ` (${unestimated} unestimated)`}
          {/* How much of the plan has a place on the timeline; nothing blocked says nothing. */}
          {blockedMinutes > 0 && <> · {formatMinutes(blockedMinutes)} blocked</>}
          {/* And how much of it the day had no room for, after the blocked figure it follows from. */}
          {unplacedMinutes > 0 && <> · {formatMinutes(unplacedMinutes)} unplaced</>}
          {/* A count of zero meetings tells a reader nothing they did not know; it only earns
           * its place once there is at least one. */}
          {meetings > 0 && <> · {count(meetings, "meeting")}</>}
          {/* The sentence is the alarm — it replaces a colour rather than joining one. */}
          {over > 0 && <> · About {roughHours(over)} more than today holds.</>}
        </span>
        {/* Inside the same region the figures announce, not a silent sibling: this is the one
         * line that explains why the middle figure just went missing. */}
        {!hasForecast && <span className="text-[11px] text-fg-faint">Not enough finished work yet to know how your estimates run.</span>}
      </span>
      <HoursChip workHours={capacity.workHours} onChange={onHours} />
    </span>
  );
}

export function HoursChip({ workHours, onChange }: { workHours: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(workHours);
  const [bad, setBad] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const fieldId = `${useId()}-work-hours`;

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setBad(false);
  }

  /** Leaving the panel saves a sane change and drops anything else, error line and all. */
  function dismiss() {
    if (draft !== workHours && parseWorkHours(draft)) onChange(draft);
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // The trigger closes the panel itself; letting it through here would fight that.
      if (panel.current?.contains(e.target as Node) || button.current?.contains(e.target as Node)) return;
      dismiss();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  /** Enter: the one place a bad range is worth complaining about rather than dropping. */
  function commit() {
    if (draft === workHours) {
      close();
      return;
    }
    if (!parseWorkHours(draft)) {
      setBad(true);
      return;
    }
    setBad(false);
    setOpen(false);
    onChange(draft);
  }

  return (
    <span className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Hours ${workHours}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="focus-ring font-mono text-[11px] text-fg-faint hover:text-fg-muted rounded-sm px-1"
        onClick={() => {
          setDraft(workHours);
          setBad(false);
          setOpen((v) => !v);
        }}
      >
        {workHours}
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Working hours" className="panel absolute right-0 top-full mt-1 rounded-md p-2 flex flex-col gap-1 z-50 w-48">
          <label className="text-[11.5px] text-fg-muted" htmlFor={fieldId}>
            Working hours
          </label>
          <input
            id={fieldId}
            ref={field}
            type="text"
            value={draft}
            aria-invalid={bad}
            placeholder="09:00-18:00"
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") close();
            }}
            onBlur={(e) => {
              // Clicking the trigger both blurs the field and toggles the panel: only the toggle counts.
              if (e.relatedTarget === button.current) return;
              dismiss();
            }}
            className={`focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border ${bad ? "border-danger" : "border-hairline"} text-fg`}
          />
          {bad && <span className="text-[11.5px] text-danger">Use HH:MM-HH:MM, start before end</span>}
        </div>
      )}
    </span>
  );
}
