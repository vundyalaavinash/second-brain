"use client";

import { useEffect, useRef, useState } from "react";
import type { CapacityDTO } from "@/lib/dto";
import { capacityTone, formatMinutes, parseWorkHours } from "@/lib/capacity";
import { count } from "./open-meeting";

/** How a capacity figure is coloured; shared with the week columns. */
export const TONE_CLASS = { ok: "text-fg-muted", warn: "text-warn", danger: "text-danger" } as const;

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
        {planned} planned · <span className={TONE_CLASS[tone]}>{formatMinutes(capacity.plannedMinutes)}</span> of {formatMinutes(capacity.freeMinutes)} free
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
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  function commit() {
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
        type="button"
        aria-label={`Hours ${workHours}`}
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
        <div className="panel absolute right-0 top-full mt-1 rounded-md p-2 flex flex-col gap-1 z-50 w-48">
          <label className="text-[11.5px] text-fg-muted" htmlFor="work-hours">
            Working hours
          </label>
          <input
            id="work-hours"
            ref={field}
            type="text"
            value={draft}
            placeholder="09:00-18:00"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={commit}
            className={`focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border ${bad ? "border-danger" : "border-hairline"} text-fg`}
          />
          {bad && <span className="text-[11.5px] text-danger">Use HH:MM-HH:MM, start before end</span>}
        </div>
      )}
    </span>
  );
}
