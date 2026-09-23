"use client";

import { useEffect, useRef, useState } from "react";
import { formatMinutes } from "@/lib/capacity";

const PRESETS = [15, 25, 45, 60, 90, 120];

/**
 * A mono chip after the due chip: "25m", "1h 30m", or "est" when nobody has guessed. The
 * popover offers the usual sizes and a free field; Enter commits, Escape closes.
 */
export function EstimateChip({ value, onChange, compact }: { value: number | null; onChange: (minutes: number | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(minutes: number | null) {
    onChange(minutes);
    setOpen(false);
    button.current?.focus();
  }
  function commitDraft() {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 5 && n <= 480) pick(n);
  }
  const label = value === null ? "Estimate: none" : `Estimate ${formatMinutes(value)}`;

  return (
    <span className={`relative ${compact ? "self-start" : "shrink-0"}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`focus-ring font-mono text-[11px] rounded-sm px-1 ${value === null ? "text-fg-faint hover:text-fg-muted" : "text-fg-muted hover:text-fg"}`}
        onClick={() => {
          setDraft(value === null ? "" : String(value));
          setOpen((v) => !v);
        }}
      >
        {value === null ? "est" : formatMinutes(value)}
      </button>
      {open && (
        <div ref={panel} role="menu" aria-label="Estimate" className="panel absolute right-0 top-full mt-1 rounded-md p-1 flex flex-col gap-0.5 w-40 z-50" onKeyDown={(e) => e.key === "Escape" && pick(value)}>
          <div className="grid grid-cols-3 gap-0.5">
            {PRESETS.map((m) => (
              <button key={m} type="button" role="menuitemradio" aria-checked={value === m} className={`focus-ring font-mono text-[11.5px] h-7 rounded-sm ${value === m ? "bg-violet-dim text-fg" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`} onClick={() => pick(m)}>
                {formatMinutes(m)}
              </button>
            ))}
          </div>
          <input
            type="number"
            aria-label="Minutes"
            min={5}
            max={480}
            step={5}
            value={draft}
            placeholder="Minutes"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitDraft()}
            className="focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border border-hairline text-fg"
          />
          <button type="button" role="menuitemradio" aria-checked={value === null} className="focus-ring text-[12px] h-7 rounded-sm text-fg-muted hover:text-fg hover:bg-layer-2 text-left px-2" onClick={() => pick(null)}>
            No estimate
          </button>
        </div>
      )}
    </span>
  );
}
