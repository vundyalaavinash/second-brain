"use client";

import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActivityMeetingDTO, MeetingItemDTO, MeetingListDTO, PlanTaskDTO } from "@/lib/dto";
import { formatClock, todayLocal } from "../activity/format";
import { count, openMeeting } from "./open-meeting";
import { blockLength, DEFAULT_BLOCK_MINUTES, parseWorkHours } from "@/lib/capacity";
import { layoutBlocks, type TimelineMeeting } from "./timeline-layout";
import { blockEnd, firstBlock, minutesToIso, snap, SNAP_MINUTES } from "./block-math";
import { PLAN_DRAG_MIME, readPlanMinutes } from "./drag-mime";
import { TaskBlock } from "./task-block";
import { useRecorder } from "./use-recorder";

/** One minute of the day is one pixel of the column: a 14-hour day is 840px, about a screen. */
const PX_PER_MIN = 1;
const TICK_MS = 60_000;
const DEFAULT_START = 9;
const DEFAULT_END = 18;
/** Below this a press is a press, not a drag: a block can be clicked without moving. */
const DRAG_SLOP = 4;

/** The hours the column covers: the working day, widened to hold every meeting on it. */
export function hourRange(meetings: TimelineMeeting[], workHours?: string): { dayStart: number; dayEnd: number } {
  const hours = workHours ? parseWorkHours(workHours) : null;
  let dayStart = hours ? Math.floor(hours.start / 60) : DEFAULT_START;
  let dayEnd = hours ? Math.ceil(hours.end / 60) : DEFAULT_END;
  for (const m of meetings) {
    const from = new Date(m.startsAt);
    const to = new Date(m.endsAt);
    dayStart = Math.min(dayStart, from.getHours());
    // One that runs past midnight ends on a later date, where its hours read as small numbers.
    // The column runs to the end of the day instead, so the span is clipped at midnight rather
    // than left as a stub below the last hour the column covers.
    const over = todayLocal(to) > todayLocal(from);
    dayEnd = Math.max(dayEnd, over ? 24 : to.getMinutes() > 0 ? to.getHours() + 1 : to.getHours());
  }
  return { dayStart, dayEnd: Math.max(dayEnd, dayStart + 1) };
}

function label(m: ActivityMeetingDTO): string {
  return `${m.title}, ${formatClock(m.startsAt)} to ${formatClock(m.endsAt)}, ${count(m.attendees, "attendee")}`;
}

/** What a captured meeting's note already holds, one dot each. A block is too small for the
 * word, so the dot carries it in a title; it takes pointer events back so the title shows. */
const BADGES: { key: keyof Omit<MeetingItemDTO, "id">; label: string; dot: string }[] = [
  { key: "hasNotes", label: "Notes", dot: "bg-violet" },
  { key: "hasTranscript", label: "Transcript", dot: "bg-violet-bright" },
  { key: "hasSummary", label: "Summary", dot: "bg-success" },
];

interface Props {
  date: string;
  meetings: MeetingListDTO[];
  /** The day's plan: the ones with a `scheduledAt` on this day get a block on the column. */
  tasks: PlanTaskDTO[];
  /** Writes one field of a task and answers whether it went through. */
  onPatchTask: (id: number, body: Record<string, unknown>) => Promise<boolean>;
  workHours?: string;
}

/** A block being placed: where its top sits, in minutes from the column's start, and how tall. */
interface Ghost {
  top: number;
  height: number;
}

/** A block being moved by the pointer, from the press until it is let go. */
interface Move {
  id: number;
  length: number;
  startY: number;
  /** Where the block's top sat when the press began, in minutes from the column's start. */
  top: number;
  moved: boolean;
}

export function Timeline({ date, meetings, tasks, onPatchTask, workHours }: Props) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const move = useRef<Move | null>(null);
  const recorder = useRecorder();

  // The line is drawn from the clock, so it has no place in the server's HTML; the first
  // tick fires straight after mount and the rest follow every minute.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // A time chip on a plan row asks for its block: the column brings it into view and hands it
  // the keyboard, so the arrows move it straight away.
  useEffect(() => {
    function onFocusBlock(e: Event) {
      const taskId = (e as CustomEvent<{ taskId: number }>).detail?.taskId;
      const block = document.querySelector<HTMLElement>(`[data-task-block="${taskId}"]`);
      block?.scrollIntoView?.({ block: "center" });
      block?.focus();
    }
    window.addEventListener("sb:timeline-focus", onFocusBlock);
    return () => window.removeEventListener("sb:timeline-focus", onFocusBlock);
  }, []);

  const allDay = meetings.filter((m) => m.allDay);
  const timed = meetings.filter((m) => !m.allDay);
  // A dropped task keeps its sessions in the database but gives up its place on the column.
  const blockedTasks = tasks.filter((t) => firstBlock(t, date) && t.status !== "dropped");
  // Negative ids: a task and a meeting never collide, and the layout only cares that ids differ.
  const taskSpans: TimelineMeeting[] = blockedTasks.map((t) => {
    const block = firstBlock(t, date)!;
    return { id: -t.id, startsAt: block.startsAt, endsAt: blockEnd(block) };
  });
  const spans = [...timed, ...taskSpans];
  const { dayStart, dayEnd } = hourRange(spans, workHours);
  const minutes = (dayEnd - dayStart) * 60;
  const hours = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => dayStart + i);
  // Meetings and blocks are placed together, so a task overlapping a meeting shares its width.
  const blocks = layoutBlocks(spans, { dayStart, dayEnd });
  const byId = new Map(timed.map((m) => [m.id, m]));
  const taskById = new Map(blockedTasks.map((t) => [t.id, t]));

  let nowTop: number | null = null;
  if (now !== null) {
    const at = new Date(now);
    const offset = at.getHours() * 60 + at.getMinutes() - dayStart * 60;
    if (todayLocal(at) === date && offset >= 0 && offset <= minutes) nowTop = offset;
  }

  function open(id: number) {
    void (async () => {
      const itemId = await openMeeting(id);
      if (itemId !== null) router.push(`/items/${itemId}`);
    })();
  }

  /** Keeps a block's top on the column, whatever the pointer did. The last slot the column
   * offers is one snap short of its end: on a column widened to midnight, a drop on the very
   * last pixel would otherwise roll the block over into tomorrow. */
  function clampTop(offset: number): number {
    return Math.max(0, Math.min(minutes - SNAP_MINUTES, offset));
  }

  /** Where the pointer is on the column, in minutes from its start, snapped to five. */
  function offsetAt(clientY: number, column: HTMLElement): number {
    return clampTop(snap((clientY - column.getBoundingClientRect().top) / PX_PER_MIN));
  }

  function schedule(id: number, offset: number) {
    void onPatchTask(id, { scheduledAt: minutesToIso(date, dayStart * 60 + offset) });
  }

  /** How long the dragged plan row's block will be, when the row said so. Through a dragover
   * the data store is protected, so the answer is read off the types rather than the data. */
  function draggedLength(e: DragEvent<HTMLElement>): number {
    return readPlanMinutes(e.dataTransfer.types) ?? DEFAULT_BLOCK_MINUTES;
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer?.types.includes(PLAN_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setGhost({ top: offsetAt(e.clientY, e.currentTarget), height: draggedLength(e) });
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // Crossing a block inside the column leaves it and enters the block: still over the column.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGhost(null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer?.types.includes(PLAN_DRAG_MIME)) return;
    e.preventDefault();
    const offset = offsetAt(e.clientY, e.currentTarget);
    const id = Number(e.dataTransfer.getData(PLAN_DRAG_MIME)) || null;
    setGhost(null);
    if (id !== null) schedule(id, offset);
  }

  /** A press on a block: nothing happens until the pointer has actually gone somewhere. */
  function onBlockPointerDown(e: PointerEvent<HTMLDivElement>, task: PlanTaskDTO, top: number) {
    if (e.button !== 0) return;
    move.current = { id: task.id, length: blockLength(task), startY: e.clientY, top, moved: false };
    try {
      columnRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* no capture: the events still bubble up to the column */
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const m = move.current;
    if (!m) return;
    // The button came back up somewhere the column never heard about: the move is over.
    if (e.buttons === 0) {
      move.current = null;
      setGhost(null);
      return;
    }
    const delta = e.clientY - m.startY;
    if (!m.moved && Math.abs(delta) < DRAG_SLOP) return;
    m.moved = true;
    setGhost({ top: clampTop(snap(m.top + delta / PX_PER_MIN)), height: m.length });
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>, commit: boolean) {
    const m = move.current;
    move.current = null;
    if (!m) return;
    setGhost(null);
    try {
      columnRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    if (commit && m.moved) schedule(m.id, clampTop(snap(m.top + (e.clientY - m.startY) / PX_PER_MIN)));
  }

  return (
    <section aria-label="Timeline" className="flex flex-col gap-3">
      {allDay.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">All day</span>
          {allDay.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => open(m.id)}
              className="focus-ring pane px-2.5 h-7 text-[12.5px] text-fg-muted hover:text-fg hover:bg-layer-2 transition-colors truncate max-w-[24ch]"
            >
              {m.title}
            </button>
          ))}
        </div>
      )}

      <div
        ref={columnRef}
        data-testid="timeline-column"
        className="relative pl-14"
        style={{ height: minutes * PX_PER_MIN }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e, true)}
        onPointerCancel={(e) => onPointerUp(e, false)}
      >
        {hours.map((hour) => (
          <div key={hour} className="absolute left-0 right-0 flex items-start gap-2" style={{ top: (hour - dayStart) * 60 * PX_PER_MIN }}>
            <span className="font-mono text-[11px] text-fg-faint w-12 shrink-0 -translate-y-1.5 text-right">{String(hour % 24).padStart(2, "0")}:00</span>
            <span className="flex-1 border-t border-hairline opacity-60" aria-hidden />
          </div>
        ))}

        {blocks.map((b) => {
          if (b.id < 0) {
            const task = taskById.get(-b.id);
            if (!task) return null;
            return (
              <TaskBlock
                key={b.id}
                task={task}
                date={date}
                top={b.top}
                height={b.height}
                col={b.col}
                cols={b.cols}
                pxPerMin={PX_PER_MIN}
                onPatch={onPatchTask}
                onDragStart={(e) => onBlockPointerDown(e, task, b.top)}
              />
            );
          }
          const m = byId.get(b.id);
          if (!m) return null;
          return (
            <div
              key={b.id}
              className="pane absolute overflow-hidden hover:bg-layer-2 transition-colors"
              style={{
                top: b.top * PX_PER_MIN,
                height: b.height * PX_PER_MIN,
                left: `calc(3.5rem + (100% - 3.5rem) * ${b.col / b.cols})`,
                width: `calc((100% - 3.5rem) / ${b.cols} - 4px)`,
              }}
            >
              {/* The block's own click target sits behind its text, so the Join link beside it
                * is a sibling rather than a link nested inside a button. */}
              <button type="button" aria-label={label(m)} onClick={() => open(b.id)} className="absolute inset-0 focus-ring rounded-md" />
              <div className="relative pointer-events-none p-2 flex flex-col gap-0.5 h-full">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[13px]">{m.title}</span>
                  {BADGES.filter((badge) => m.item?.[badge.key]).map((badge) => (
                    <span key={badge.label} className={`w-1.5 h-1.5 rounded-full shrink-0 pointer-events-auto ${badge.dot}`} title={badge.label} />
                  ))}
                </span>
                <span className="font-mono text-[11px] text-fg-faint">
                  {formatClock(m.startsAt)}–{formatClock(m.endsAt)}
                </span>
                {b.height >= 48 && (
                  <span className="flex items-center gap-2 text-[11.5px] text-fg-faint">
                    <span>{count(m.attendees, "attendee")}</span>
                    {m.joinUrl && (
                      <a
                        href={m.joinUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Join ${m.title}`}
                        className="focus-ring rounded-sm text-violet-bright hover:underline pointer-events-auto"
                      >
                        Join
                      </a>
                    )}
                    {/* The block itself is a button, so this one sits above it and takes back the
                      * pointer; a disabled button takes none, so the reason hangs on the wrapper. */}
                    <span title={recorder.title ?? undefined} className="pointer-events-auto">
                      <button
                        type="button"
                        onClick={() => recorder.record({ calendarEventId: m.id })}
                        disabled={!!recorder.blocked}
                        aria-label={`Record ${m.title}`}
                        title={recorder.title ?? undefined}
                        className="focus-ring rounded-sm text-fg-muted hover:text-fg hover:underline disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Record
                      </button>
                    </span>
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {ghost && (
          <div
            data-testid="block-ghost"
            aria-hidden
            className="absolute left-14 right-2 rounded-md border border-dashed border-violet bg-violet-dim/50 pointer-events-none"
            style={{ top: ghost.top * PX_PER_MIN, height: ghost.height * PX_PER_MIN }}
          >
            {/* The slot it would take, spelled out: the picture under the pointer and the rule
              * lines say roughly where; this says exactly. */}
            <span className="absolute -top-2.5 left-1.5 px-1 rounded-sm bg-carbon font-mono text-[11px] text-violet-bright">
              {formatClock(minutesToIso(date, dayStart * 60 + ghost.top))}
            </span>
          </div>
        )}

        {nowTop !== null && (
          <div className="absolute left-14 right-0 flex items-center pointer-events-none" style={{ top: nowTop * PX_PER_MIN }} aria-hidden>
            <span className="w-1.5 h-1.5 rounded-full bg-violet -ml-0.5 shrink-0" />
            <span className="flex-1 border-t border-violet" />
          </div>
        )}
      </div>

      {meetings.length === 0 && blockedTasks.length === 0 && <p className="text-[13px] text-fg-faint m-0">No meetings on this day</p>}
    </section>
  );
}
