"use client";
import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSlot } from "./use-slot";

/** Portals a page's context column into the shell's rail slot. */
export function Rail({ children }: { children: ReactNode }) {
  const slot = useSlot("rail-slot");
  if (!slot) return null;
  return createPortal(
    <aside aria-label="Context" className="flex flex-col gap-6 p-4 h-full overflow-y-auto">
      {children}
    </aside>,
    slot,
  );
}

export function RailSection({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="micro">{label}</span>
        {count !== undefined && <span className="font-mono text-[11px] text-fg-faint">{count}</span>}
      </div>
      {children}
    </section>
  );
}
