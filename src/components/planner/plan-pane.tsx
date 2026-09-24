"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MoreHorizontal } from "lucide-react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { capacityTone, formatMinutes } from "@/lib/capacity";
import { sessionsFor } from "@/lib/scheduler";
import { addDaysLocal } from "../activity/format";
import { Button, IconButton, List } from "../ui";
import { MENU_ITEM, TaskRow } from "../tasks/task-row";
import { FocusButton } from "../focus/focus-button";
import { BreakOffer } from "../focus/break-offer";
import { blocksOn, minutesToIso, SNAP_MINUTES } from "./block-math";
import { count } from "./open-meeting";
import { placeDay, SAVE_ERROR } from "./place-day";
import { RitualStrip, ritualDoneKey, ritualSteps } from "./ritual-strip";
import { PLAN_DRAG_MIME, planMinutesType } from "./drag-mime";
import { PlanPicker } from "./plan-picker";

const JSON_HEADERS = { "content-type": "application/json" };
const DRAG_CHIP_ID = "plan-drag-chip";

/** The picture a dragged plan row shows: its title and its session length, one line, under the pointer. */
function dragChip(task: TaskDTO, minutes: number): HTMLElement | null {
  if (typeof document === "undefined") return null;
  document.getElementById(DRAG_CHIP_ID)?.remove();
  const el = document.createElement("div");
  el.id = DRAG_CHIP_ID;
  el.className = "panel fixed top-0 left-0 -z-10 rounded-md px-2.5 h-8 flex items-center gap-2 text-[13px] text-fg whitespace-nowrap pointer-events-none";
  el.textContent = task.title;
  const len = document.createElement("span");
  len.className = "font-mono text-[11px] text-fg-muted";
  len.textContent = formatMinutes(minutes);
  el.appendChild(len);
  document.body.appendChild(el);
  return el;
}
/** How full the day reads at a glance; the header line says it in words. */
const BAR_CLASS = { ok: "bg-violet", warn: "bg-warn", danger: "bg-danger" } as const;
/** Spec §7: rows settle in 200 ms, the ritual folds away on a spring. */
const ROW_MOTION = {
  layout: true,
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};
const RITUAL_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { type: "spring", stiffness: 420, damping: 38, mass: 0.6 },
} as const;

/** The next five-minute mark after now: 10:30 and 10:34 both start at 10:35. The last one the
 * day holds is 23:55, so a block taken out at 23:58 does not begin tomorrow. */
function nextSlot(minutes: number): number {
  return Math.min(24 * 60 - SNAP_MINUTES, Math.ceil((minutes + 1) / SNAP_MINUTES) * SNAP_MINUTES);
}

/** Spec §3: a row dropped on the column places exactly one session, this long. */
function dropLength(task: TaskDTO): number {
  return sessionsFor(task.estimateMinutes, task.sessionMinutes)[0];
}

/** The clock as minutes since local midnight, for a block that starts "now". */
function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, for the row's own "today" reckoning. */
  today: string;
  onRefresh: () => void;
  /** Home shows the plan without the morning ritual: spec §2 keeps the strip on the Planner. */
  hideRitual?: boolean;
  /** Names the section when it is one of several on a page, so landmark navigation reaches it. */
  label?: string;
}

/** The day's plan, and the picker under it that feeds it: everything else is a row menu away. */
export function PlanPane({ day, today, onRefresh, hideRitual = false, label }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  // The morning ritual belongs to today alone. Whether it was already walked through lives in
  // the browser, so the answer is null until the effect has read it and the strip's place stays
  // empty for that first frame rather than flashing a ritual the day is already past.
  const [ritual, setRitual] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Latched by the strip's first action: from then on a plan that gains tasks does not end it.
  const [started, setStarted] = useState(false);
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLUListElement | null>(null);
  const headingRef = useRef<HTMLSpanElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  // Where the keyboard should land once the day the unplan asked for has come back: the id of
  // the row that will take the departing one's place, or 0 for the pane's own heading.
  const refocus = useRef<number | null>(null);

  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(ritualDoneKey(day.date)) === "1";
    } catch {
      /* no storage: the strip simply shows */
    }
    queueMicrotask(() => setRitual(day.date === today && !done));
  }, [day.date, today]);

  // A task planned from the picker before the ritual began says the morning is already under
  // way: the strip stands aside, and stays away for the rest of the day.
  useEffect(() => {
    if (hideRitual || ritual !== true || started || day.plan.length === 0) return;
    try {
      localStorage.setItem(ritualDoneKey(day.date), "1");
    } catch {
      /* no storage: the strip returns on the next load */
    }
    queueMicrotask(() => setRitual(false));
  }, [hideRitual, ritual, started, day.plan.length, day.date]);

  // Everything that moves a task or a plan entry says so; the pane reloads the whole day
  // rather than guessing which half of it changed.
  useEffect(() => {
    function onChanged() {
      onRefresh();
    }
    window.addEventListener("sb:plan-changed", onChanged);
    window.addEventListener("sb:tasks-changed", onChanged);
    return () => {
      window.removeEventListener("sb:plan-changed", onChanged);
      window.removeEventListener("sb:tasks-changed", onChanged);
    };
  }, [onRefresh]);

  // The header menu is a plain panel beside its button: Escape and a click away close it, and
  // the keyboard goes back where it came from.
  useEffect(() => {
    if (!menuOpen) return;
    function close() {
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      close();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  // A row unplanned from the keyboard takes the focus with it. The new plan is here, so the
  // neighbour noted before the request takes it over — no state, only the DOM call.
  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    if (id === 0) headingRef.current?.focus();
    else listRef.current?.querySelector<HTMLElement>(`[data-task-id="${id}"] button[data-title]`)?.focus();
  }, [day.plan]);

  /** Answers whether the request went through, so a two-step drop can stop after a failed first half. */
  async function send(url: string, method: string, body?: unknown, event: string | null = "sb:tasks-changed"): Promise<boolean> {
    const res = await fetch(url, { method, headers: body ? JSON_HEADERS : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      setError(SAVE_ERROR);
      return false;
    }
    setError(null);
    if (event) window.dispatchEvent(new Event(event));
    return true;
  }

  const patch = (id: number, body: Record<string, unknown>) => void send(`/api/tasks/${id}`, "PATCH", body);
  const remove = (id: number) => void send(`/api/tasks/${id}`, "DELETE");
  const reorder = (taskIds: number[]) => void send("/api/plan", "PATCH", { date: day.date, taskIds }, "sb:plan-changed");
  const carryOver = () => void send("/api/plan/carry-over", "POST", { from: addDaysLocal(day.date, -1), to: day.date }, "sb:plan-changed");
  const sortByTime = () => void send("/api/plan/sort", "POST", { date: day.date }, "sb:plan-changed");

  /** Spec §3's fill, shared with Home: the request, the announcement, the toast and its offer
   * all live in `placeDay`; the pane only says where an error should go. */
  const place = (date: string, taskId: number | null, offerNext: boolean) => placeDay(date, { taskId, today, offerNext, onError: setError });

  /** Spec §4: how long each of the task's sessions should be. A task that already holds sessions
   * on the day is laid out again at the new length rather than left half-split. One announcement
   * either way: the place makes it where there is one, the length's own write where there is not. */
  async function split(task: TaskDTO, minutes: number | null) {
    if (!(await send(`/api/tasks/${task.id}`, "PATCH", { sessionMinutes: minutes }, null))) return;
    if (blocksOn(task, day.date).length > 0) await place(day.date, task.id, true);
    else window.dispatchEvent(new Event("sb:tasks-changed"));
  }

  /** Takes a task off the plan and says where the keyboard goes once the day comes back. */
  async function unplan(taskId: number) {
    const ids = day.plan.map((t) => t.id);
    const i = ids.indexOf(taskId);
    // Next, else previous, else nothing is left and the pane's heading holds the place.
    refocus.current = i === -1 ? null : (ids[i + 1] ?? ids[i - 1] ?? 0);
    if (!(await send("/api/plan", "DELETE", { date: day.date, taskId }, "sb:plan-changed"))) refocus.current = null;
  }

  /** The plan row carried by a drag, when that is what the drag holds. */
  function draggedPlanId(e: DragEvent<HTMLElement>): number | null {
    if (!e.dataTransfer?.types.includes(PLAN_DRAG_MIME)) return null;
    e.preventDefault();
    return Number(e.dataTransfer.getData(PLAN_DRAG_MIME)) || null;
  }

  function clearDrag() {
    setOver(false);
  }

  function handleRowDrop(rowId: number, e: DragEvent<HTMLLIElement>) {
    // A row drop means "here", never "at the end": the list behind it must not answer as well.
    e.stopPropagation();
    clearDrag();
    const ids = day.plan.map((t) => t.id);
    const from = ids.indexOf(dragId ?? -1);
    const to = ids.indexOf(rowId);
    setDragId(null);
    if (dragId === null || dragId === rowId || from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    reorder(ids);
  }

  /** A plan row dropped on the list's own area rather than on a row: it goes last. */
  function moveToEnd(id: number) {
    const ids = day.plan.map((t) => t.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === ids.length - 1) return;
    ids.splice(from, 1);
    ids.push(id);
    reorder(ids);
  }

  function row(task: TaskDTO) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        today={today}
        as={reduce ? undefined : motion.li}
        rowProps={reduce ? undefined : ROW_MOTION}
        onToggle={() => patch(task.id, { status: task.status === "done" ? "open" : "done" })}
        onRename={(title) => patch(task.id, { title })}
        onDue={(value) => patch(task.id, { dueDate: value })}
        onEstimate={(m) => patch(task.id, { estimateMinutes: m })}
        onPriority={(priority: TaskPriority) => patch(task.id, { priority })}
        onDrop={() => patch(task.id, { status: "dropped" })}
        onDelete={() => remove(task.id)}
        onPlan={() => void unplan(task.id)}
        // The pane is one day's plan, so a chip here only leads to a block that is on it.
        blockDate={day.date}
        // "Now" only means something on the day being lived through; other days are placed by hand.
        onBlockNow={
          day.date === today
            ? () => void send("/api/blocks", "POST", { taskId: task.id, startsAt: minutesToIso(today, nextSlot(nowMinutes())), minutes: dropLength(task) })
            : undefined
        }
        // Spec §4: the row's own unblock takes the whole day, not one session of it.
        onUnblock={() => void send(`/api/tasks/${task.id}/blocks?date=${day.date}`, "DELETE")}
        onPlace={() => void place(day.date, task.id, true)}
        onSplit={(minutes) => void split(task, minutes)}
        planned
        draggable
        onDragStart={(e) => {
          setDragId(task.id);
          // The timeline accepts this one to give the task a block; the second type spells out
          // the length, which is all a dragover is allowed to read, and sizes the ghost.
          e.dataTransfer.setData(PLAN_DRAG_MIME, String(task.id));
          // The data is the same number again, so nothing depends on a browser keeping an
          // entry whose value is empty; only the type is ever read.
          e.dataTransfer.setData(planMinutesType(dropLength(task)), String(dropLength(task)));
          e.dataTransfer.effectAllowed = "move";
          // The browser would otherwise drag the whole row from wherever it was grabbed, and the
          // block then lands where the pointer is, well below the row's picture. A small chip
          // pinned to the pointer's top-left says what is moving and where it will start.
          const chip = dragChip(task, dropLength(task));
          if (chip) e.dataTransfer.setDragImage(chip, 8, 8);
        }}
        onDragEnd={() => {
          document.getElementById(DRAG_CHIP_ID)?.remove();
          setDragId(null);
        }}
        onDragOver={(e) => {
          // Only another plan row may land here; everything else keeps its own drop.
          if (e.dataTransfer?.types.includes(PLAN_DRAG_MIME)) e.preventDefault();
        }}
        onRowDrop={(e) => handleRowDrop(task.id, e)}
      />
    );
  }

  // Today, not yet walked through, and either still empty or mid-ritual: the strip takes over
  // the carry-over line too.
  // A ritual with no step to offer is not shown at all; once started it runs to the end.
  const showRitual = !hideRitual && ritual === true && (started || (day.plan.length === 0 && ritualSteps(day).length > 0));
  const capacity = day.capacity;
  const tone = capacityTone(capacity.plannedMinutes, capacity.freeMinutes);
  const fill = Math.min(100, capacity.freeMinutes ? (capacity.plannedMinutes / capacity.freeMinutes) * 100 : capacity.plannedMinutes ? 100 : 0);
  // Blocked time is measured against the same track as the fill, not against the fill itself:
  // a block on a task nobody estimated is real time on the timeline, and the estimates it is
  // missing from would otherwise keep it off the bar altogether.
  const blockedFill = Math.min(100, capacity.freeMinutes ? (capacity.blockedMinutes / capacity.freeMinutes) * 100 : capacity.blockedMinutes ? 100 : 0);
  const ritualStrip = <RitualStrip day={day} today={today} onStarted={() => setStarted(true)} onDone={() => setRitual(false)} />;
  // The header has room a packed row does not: the plan's first open task gets the quick-start
  // button, with the length menu, rather than making the person open a row's own menu first.
  const nextUp = day.plan.find((t) => t.status !== "done");

  return (
    <section aria-label={label} className="pane p-4 flex flex-col gap-3">
      {/* Takes focus when the last plan row is unplanned from the keyboard, so the keyboard
        * stays in the pane rather than falling back to the document. */}
      <div className="flex items-center justify-between gap-2">
        <span ref={headingRef} tabIndex={-1} className="focus-ring micro rounded-sm">
          Plan
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {nextUp && <FocusButton task={{ id: nextUp.id, title: nextUp.title }} menu />}
          <span className="relative shrink-0">
            <IconButton
              label="Plan actions"
              icon={MoreHorizontal}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                menuButtonRef.current = e.currentTarget;
                setMenuOpen((v) => !v);
              }}
            />
            {menuOpen && (
              <div ref={menuPanelRef} role="menu" aria-label="Plan actions" className="panel absolute right-0 top-full mt-1 rounded-md p-1 flex flex-col gap-0.5 w-max min-w-40 z-50">
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    menuButtonRef.current?.focus();
                    void place(day.date, null, true);
                  }}
                >
                  Fill the day
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    menuButtonRef.current?.focus();
                    sortByTime();
                  }}
                >
                  Sort by time
                </button>
              </div>
            )}
          </span>
        </span>
      </div>

      <div className="relative h-1 rounded-full bg-layer-2 overflow-hidden" aria-hidden>
        <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_CLASS[tone]}`} style={{ width: `${fill}%` }} />
        {/* How much of the day already has a place on the timeline, brighter over the fill. */}
        {blockedFill > 0 && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-violet-bright transition-[width] duration-300" style={{ width: `${blockedFill}%` }} />
        )}
      </div>

      <BreakOffer />

      {day.unfinishedYesterday.length > 0 && !showRitual && (
        <div className="flex items-center gap-3 rounded-md bg-layer-2 border border-hairline px-3 py-2">
          <span className="text-[12.5px] text-fg-muted flex-1 min-w-0">{count(day.unfinishedYesterday.length, "unfinished task")} from yesterday</span>
          <Button size="sm" onClick={carryOver}>
            Carry over
          </Button>
        </div>
      )}

      {reduce ? (
        showRitual && ritualStrip
      ) : (
        <AnimatePresence initial={false}>
          {showRitual && (
            <motion.div key="ritual" className="overflow-hidden" {...RITUAL_MOTION}>
              {ritualStrip}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {!showRitual && day.plan.length === 0 && ritual !== null && (
        <p className="text-[13px] text-fg-faint m-0">Nothing planned. Add a task below, or press p on any task.</p>
      )}

      <List
        ref={listRef}
        aria-label="Plan"
        className={`border rounded-md transition-[colors,padding] duration-100 ${over ? "border-violet pb-6" : "border-transparent"} ${day.plan.length === 0 ? "min-h-11" : ""}`}
        onDragOver={(e) => {
          // A plan row dropped on the list's own area moves last.
          if (!e.dataTransfer?.types.includes(PLAN_DRAG_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          // Moving between two rows leaves one and enters another: the list itself is still under the cursor.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearDrag();
        }}
        onDrop={(e) => {
          clearDrag();
          const moved = draggedPlanId(e);
          setDragId(null);
          if (moved !== null) moveToEnd(moved);
        }}
      >
        {reduce ? day.plan.map(row) : <AnimatePresence initial={false}>{day.plan.map(row)}</AnimatePresence>}
      </List>

      <PlanPicker day={day} today={today} />

      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
