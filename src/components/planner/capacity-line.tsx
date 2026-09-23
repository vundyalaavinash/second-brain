"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CapacityDTO } from "@/lib/dto";
import { CAPACITY_TONE_CLASS, capacityTone, formatMinutes, parseWorkHours } from "@/lib/capacity";
import { count } from "./open-meeting";

interface Props {
  capacity: CapacityDTO;
  /** Tasks on the plan, whatever their estimates. */
  planned: number;
  meetings: number;
  onHours: (workHours: string) => void;
}

/**
 * The Day header's mono line: how much is planned against the time the calendar leaves,
 * and a chip to say what the working hours are.
 */
export function CapacityLine({ capacity, planned, meetings, onHours }: Props) {
  const tone = capacityTone(capacity.plannedMinutes, capacity.freeMinutes);
  const over = capacity.plannedMinutes - capacity.freeMinutes;
  const title = over > 0 ? `Plan is ${formatMinutes(over)} over the free time` : undefined;
  return (
    <span className="flex items-center gap-3 flex-wrap justify-end">
      <span role="status" title={title} className="font-mono text-[12px] text-fg-muted">
        {planned} planned · <span className={CAPACITY_TONE_CLASS[tone]}>{formatMinutes(capacity.plannedMinutes)}</span> of {formatMinutes(capacity.freeMinutes)} free
        {capacity.unestimated > 0 && ` (${capacity.unestimated} unestimated)`} · {count(meetings, "meeting")}
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
        <div ref={panel} className="panel absolute right-0 top-full mt-1 rounded-md p-2 flex flex-col gap-1 z-50 w-48">
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
