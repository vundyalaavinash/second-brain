"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { formatMinutes } from "@/lib/capacity";

const PRESETS = [15, 25, 45, 60, 90, 120];
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

/**
 * A mono chip after the due chip: "25m", "1h 30m", or "est" when nobody has guessed. The
 * popover offers the usual sizes and a free field; Enter commits, Escape closes without saving.
 */
export function EstimateChip({ value, onChange, compact }: { value: number | null; onChange: (minutes: number | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  // Portalled and positioned against the trigger the way task-row.tsx places its actions menu.
  // Fixed, so a scrolling pane around the row cannot clip the panel at narrow widths.
  useEffect(() => {
    if (!open) return;
    const buttonEl = button.current;
    const panelEl = panel.current;
    if (!buttonEl || !panelEl) return;
    return autoUpdate(buttonEl, panelEl, () => {
      void computePosition(buttonEl, panelEl, { strategy: "fixed", placement: "bottom-end", middleware: [offset(4), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        setPos({ top: y, left: x });
      });
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** Escape and an outside click both leave the estimate as it was. */
  function close() {
    setOpen(false);
    setBad(false);
    button.current?.focus();
  }
  function pick(minutes: number | null) {
    onChange(minutes);
    setBad(false);
    setOpen(false);
    button.current?.focus();
  }
  function commitDraft() {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES) pick(n);
    else setBad(true);
  }
  const label = value === null ? "Estimate: none" : `Estimate ${formatMinutes(value)}`;

  return (
    // The panel is portalled, so this covers the trigger and, through the React tree, the panel.
    <span className={`relative ${compact ? "self-start" : "shrink-0"}`} onKeyDown={(e) => open && e.key === "Escape" && close()}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`focus-ring font-mono text-[11px] rounded-sm px-1 ${value === null ? "text-fg-faint hover:text-fg-muted" : "text-fg-muted hover:text-fg"}`}
        onClick={() => {
          setDraft(value === null ? "" : String(value));
          setBad(false);
          setOpen((v) => !v);
        }}
      >
        {value === null ? "est" : formatMinutes(value)}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label="Estimate"
            className="panel rounded-md p-1 flex flex-col gap-0.5 w-40 z-50"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
          >
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
              aria-invalid={bad}
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={5}
              value={draft}
              placeholder="Minutes"
              onChange={(e) => {
                setDraft(e.target.value);
                setBad(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && commitDraft()}
              className={`focus-ring font-mono text-[12px] h-7 px-2 rounded-sm bg-layer-2 border ${bad ? "border-danger" : "border-hairline"} text-fg`}
            />
            {bad && <span className="text-[11.5px] text-danger px-2">Between 5 and 480 minutes</span>}
            <button type="button" role="menuitemradio" aria-checked={value === null} className="focus-ring text-[12px] h-7 rounded-sm text-fg-muted hover:text-fg hover:bg-layer-2 text-left px-2" onClick={() => pick(null)}>
              No estimate
            </button>
          </div>,
          document.body,
        )}
    </span>
  );
}
