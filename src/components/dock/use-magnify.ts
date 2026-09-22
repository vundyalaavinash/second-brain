"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

/** The dock's falloff: full `max` under the cursor, back to rest at `radius` and beyond. */
export function magnifyScale(dx: number, max: number, radius: number): number {
  return 1 + (max - 1) * Math.max(0, 1 - Math.abs(dx) / radius);
}

export interface Magnify {
  /** Scale for the item at `index`; 1 once the pointer has left or motion is reduced. */
  scaleAt(index: number): number;
  onPointerMove(e: { clientX: number; currentTarget: HTMLElement }): void;
  onPointerLeave(): void;
}

/**
 * Cursor-distance magnification for a row of items. The items are read out of the row the
 * pointer is over, in document order, so adding or removing one (the narrow layout, the More
 * button) needs no extra wiring.
 */
export function useMagnify({ max, radius }: { max: number; radius: number }): Magnify {
  const [scales, setScales] = useState<number[]>([]);
  // Read once into a ref: the hook must never look at `matchMedia` during a render, and a
  // scale that stays at 1 does not need to re-render anything on its own.
  const reduced = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCED);
    reduced.current = mq.matches;
    function onChange() {
      reduced.current = mq.matches;
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const onPointerMove = useCallback(
    (e: { clientX: number; currentTarget: HTMLElement }) => {
      if (reduced.current) return;
      // The row comes from the event rather than the ref: the handler is the only place that
      // may touch the DOM, and `currentTarget` is the row the pointer is actually over.
      const items = e.currentTarget.querySelectorAll<HTMLElement>("[data-dock-item]");
      setScales(
        Array.from(items, (el) => {
          const box = el.getBoundingClientRect();
          return magnifyScale(box.left + box.width / 2 - e.clientX, max, radius);
        }),
      );
    },
    [max, radius],
  );

  const onPointerLeave = useCallback(() => setScales([]), []);

  const scaleAt = useCallback((index: number) => scales[index] ?? 1, [scales]);

  return { scaleAt, onPointerMove, onPointerLeave };
}
