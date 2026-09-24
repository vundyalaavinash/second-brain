"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { PlanTaskDTO } from "@/lib/dto";
import { formatMinutes } from "@/lib/capacity";
import { formatClock } from "../activity/format";
import { blockEnd, firstBlock, isoToMinutes, minutesToIso, snap } from "./block-math";

interface Props {
  task: PlanTaskDTO;
  date: string;
  /** Pixel geometry from the layout, in minutes from the column's start. */
  top: number;
  height: number;
  col: number;
  cols: number;
  pxPerMin: number;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<boolean>;
  /** Moving from the pointer: the timeline owns the ghost, the block only reports. */
  onDragStart: (e: PointerEvent<HTMLDivElement>) => void;
}

const MOVE = 15;
const FINE = 5;
const MIN_LENGTH = 5;
const MAX_LENGTH = 480;
const DEFAULT_LENGTH = 25;

/**
 * A planned task on the timeline: the title, the hours, an estimate, a checkbox that finishes
 * it where it sits. Arrows move it, Alt and arrows resize it, Backspace takes it off the
 * timeline (the task stays on the plan). Done blocks stay, dimmed and struck through.
 */
export function TaskBlock({ task, date, top, height, col, cols, pxPerMin, onPatch, onDragStart }: Props) {
  const [resizing, setResizing] = useState(false);
  const reduce = useReducedMotion();
  // A resize in flight, as the one call that takes its window listeners off again. Held in a
  // ref so a block that goes away mid-drag — the day reloading under it — leaves none behind.
  const detachResize = useRef<(() => void) | null>(null);
  useEffect(() => () => detachResize.current?.(), []);
  // The start the last arrow wrote, until the day comes back holding it. Two presses in a row
  // are faster than the round trip, and the second must count from the first's answer rather
  // than from a prop that has not moved yet.
  const pending = useRef<number | null>(null);
  // Only the ref: whatever the prop moved to is the truth now, whether it caught up with what
  // was written here or a pointer drag landed first, so the next move counts from it.
  const session = firstBlock(task, date)!;
  useEffect(() => {
    pending.current = null;
  }, [session.startsAt]);
  const start = session.startsAt;
  const end = blockEnd(session);
  const done = task.status === "done";
  const name = `${task.title}, ${formatClock(start)} to ${formatClock(end)}`;

  async function move(deltaMinutes: number) {
    const from = pending.current ?? isoToMinutes(start);
    const next = Math.max(0, Math.min(24 * 60 - FINE, snap(from + deltaMinutes)));
    const before = pending.current;
    // Noted before the write, so the next press already counts from here; a write that fails
    // never happened, and the ref goes back to what it was.
    pending.current = next;
    if (await onPatch(task.id, { scheduledAt: minutesToIso(date, next) })) {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: `Moved to ${formatClock(minutesToIso(date, next))}` } }));
    } else {
      pending.current = before;
    }
  }

  async function resize(deltaMinutes: number) {
    const next = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, (task.estimateMinutes ?? DEFAULT_LENGTH) + deltaMinutes));
    await onPatch(task.id, { estimateMinutes: next });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? FINE : MOVE;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sign = e.key === "ArrowDown" ? 1 : -1;
      if (e.altKey) void resize(sign * FINE);
      else void move(sign * step);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      void onPatch(task.id, { scheduledAt: null });
    }
  }

  // Resizing by pointer: the bottom edge follows the pointer in 5-minute steps and writes the
  // estimate once on release. The element is caught before the handler returns, because React
  // clears `currentTarget` the moment it does.
  function onResizeDown(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const block = e.currentTarget.parentElement as HTMLElement | null;
    const startY = e.clientY;
    const startLen = task.estimateMinutes ?? DEFAULT_LENGTH;
    const lengthAt = (y: number) => Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, snap(startLen + (y - startY) / pxPerMin)));

    function detach() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      detachResize.current = null;
    }
    /** Ends the session and puts the layout's own height back, before anything is written: a
     * resize that changes nothing, or that fails, leaves no dragged pixels behind. React
     * believes the node still holds the prop's height, so it has to be written back by hand. */
    function finish() {
      detach();
      if (block) block.style.height = `${height * pxPerMin}px`;
      setResizing(false);
    }
    function onMove(ev: MouseEvent) {
      if (block) block.style.height = `${lengthAt(ev.clientY) * pxPerMin}px`;
    }
    function onUp(ev: MouseEvent) {
      const next = lengthAt(ev.clientY);
      finish();
      if (next !== startLen) void onPatch(task.id, { estimateMinutes: next });
    }
    // A cancelled pointer — a touch turning into a scroll, the window losing it — ends the
    // session without writing anything.
    function onCancel() {
      finish();
    }

    detachResize.current = detach;
    setResizing(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // Everything that names the block and answers to it: the same element either way, so the
  // focus, the keyboard and the pointer never notice which one is rendered.
  const blockProps = {
    role: "group",
    "aria-label": name,
    tabIndex: 0,
    "data-task-block": task.id,
    onKeyDown: onKey,
    onPointerDown: done ? undefined : onDragStart,
    className: `focus-ring absolute rounded-md border-l-2 border-violet bg-violet-dim overflow-hidden select-none ${done ? "opacity-50" : ""} ${resizing ? "cursor-ns-resize" : "cursor-grab"}`,
    style: {
      top: top * pxPerMin,
      height: height * pxPerMin,
      left: `calc(3.5rem + (100% - 3.5rem) * ${col / cols})`,
      width: `calc((100% - 3.5rem) / ${cols} - 4px)`,
    },
  } as const;

  const inside = (
    <>
      <div className="p-2 flex flex-col gap-0.5 h-full pointer-events-none">
        <span className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            aria-label={`Done: ${task.title}`}
            checked={done}
            onChange={() => void onPatch(task.id, { status: done ? "open" : "done" })}
            onPointerDown={(e) => e.stopPropagation()}
            className="focus-ring accent-violet w-3.5 h-3.5 shrink-0 pointer-events-auto"
          />
          <span className={`truncate text-[13px] ${done ? "line-through text-fg-muted" : ""}`}>{task.title}</span>
        </span>
        <span className="font-mono text-[11px] text-fg-faint">
          {formatClock(start)}–{formatClock(end)} · {formatMinutes(session.minutes)}
        </span>
      </div>
      {/* The keyboard resizes with Alt and the arrows on the group itself, so the handle is a
        * pointer affordance only: out of the tab order and out of the accessibility tree. */}
      {!done && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-resize={task.id}
          onPointerDown={onResizeDown}
          className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize pointer-events-auto"
        />
      )}
    </>
  );

  // Spec §7: a block settles into its new top and height over 200 ms, so a move or a resize
  // elsewhere on the column is followed rather than jumped. Reduced motion gets a plain div.
  return reduce ? (
    <div {...blockProps}>{inside}</div>
  ) : (
    <motion.div layout transition={{ duration: 0.2 }} {...blockProps}>
      {inside}
    </motion.div>
  );
}
