"use client";

import { useEffect, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import type { PlannerWeekDTO, PlannerWeekDayDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { CAPACITY_TONE_CLASS, capacityTone, formatMinutes, overBasis } from "@/lib/capacity";
import { formatClock } from "../activity/format";
import { List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { openMeeting } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";
/** The drag's own type, so a column only accepts a task dragged from another column. */
const TASK_MIME = "text/task-id";
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
}

export function WeekView({ week, today, onRefresh }: { week: PlannerWeekDTO; today: string; onRefresh: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onChanged() {
      onRefresh();
    }
    window.addEventListener("sb:tasks-changed", onChanged);
    window.addEventListener("sb:plan-changed", onChanged);
    return () => {
      window.removeEventListener("sb:tasks-changed", onChanged);
      window.removeEventListener("sb:plan-changed", onChanged);
    };
  }, [onRefresh]);

  async function send(url: string, method: string, body?: unknown, event = "sb:tasks-changed") {
    const res = await fetch(url, { method, headers: body ? JSON_HEADERS : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      setError(SAVE_ERROR);
      return;
    }
    setError(null);
    window.dispatchEvent(new Event(event));
  }

  const patch = (id: number, body: Record<string, unknown>) => void send(`/api/tasks/${id}`, "PATCH", body);
  const remove = (id: number) => void send(`/api/tasks/${id}`, "DELETE");
  const planOn = (taskId: number, date: string) => void send("/api/plan", "POST", { date, taskId }, "sb:plan-changed");

  function onDropOnDay(e: DragEvent<HTMLDivElement>, date: string) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(TASK_MIME);
    if (!raw) return;
    patch(Number(raw), { dueDate: date });
  }

  function openMeetingItem(id: number) {
    void (async () => {
      const itemId = await openMeeting(id);
      if (itemId === null) {
        setError("Could not open that meeting");
        return;
      }
      setError(null);
      router.push(`/items/${itemId}`);
    })();
  }

  function column(day: PlannerWeekDayDTO) {
    const isToday = day.date === today;
    return (
      <div
        key={day.date}
        className="pane p-3 flex flex-col gap-2 min-w-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDropOnDay(e, day.date)}
      >
        <span className="flex items-baseline gap-2">
          <span className={`font-doc text-[24px] leading-none ${isToday ? "text-violet-bright" : ""}`}>{Number(day.date.slice(8, 10))}</span>
          <span className="micro">{weekdayOf(day.date)}</span>
        </span>
        {/* A day nobody works is a quiet gap: the date above, and nothing here about capacity —
          * not "0h", not a struck-through nine hours. */}
        {day.working && (() => {
          // Today and every day still ahead read `leftTodayMinutes`, the same honesty
          // `plannerDay` gives the day view — the remainder of today, or a day ahead's whole
          // window. A day already gone is different: `leftTodayMinutes` is 0 there by design
          // (§4.3's "time left" is a live figure about now), but a *past* column is a ratio of
          // what was planned against what the day had, and a past day genuinely had its whole
          // window — zero as a denominator would read as "100% over" on a day that is simply
          // over. So a past day reads `freeMinutes`, the window itself, instead (N2).
          const denom = day.date < today ? day.capacity.freeMinutes : day.capacity.leftTodayMinutes;
          // The tone, not the printed figure, reads `overBasis`: the Day view's line and its
          // meter both judge a day by the forecast when one exists (`capacity-line.tsx`,
          // `plan-pane.tsx`), so a column here must not read the same day as calm on the strength
          // of the bare plan alone (F1) — `week.drift` is the one multiplier for the whole week,
          // applied to this day's own planned minutes, same as `capacity.forecastMinutes` was
          // built from it (`src/lib/planner.ts`).
          const tone = capacityTone(overBasis({ ...day.capacity, drift: week.drift }), denom);
          return (
            <span className={`font-mono text-[11px] ${CAPACITY_TONE_CLASS[tone]}`}>
              {formatMinutes(day.capacity.plannedMinutes)} / {formatMinutes(denom)}
              {/* A column is too narrow for the figure: the dot says the day has blocks, the title how many. */}
              {day.capacity.blockedMinutes > 0 && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-violet ml-1 align-middle"
                  title={`${formatMinutes(day.capacity.blockedMinutes)} blocked`}
                  aria-label={`${formatMinutes(day.capacity.blockedMinutes)} blocked`}
                  role="img"
                />
              )}
            </span>
          );
        })()}

        {day.meetings.length > 0 && (
          <ul role="list" className="list-none m-0 p-0 flex flex-col">
            {day.meetings.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openMeetingItem(m.id)}
                  className="focus-ring w-full flex items-center gap-2 h-7 px-1 rounded-sm text-left hover:bg-layer-2 transition-colors"
                >
                  <span className="font-mono text-[11px] text-fg-faint shrink-0">{m.allDay ? "All day" : formatClock(m.startsAt)}</span>
                  <span className="truncate text-[12.5px]">{m.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* The column's own day leads the "Plan for" list, so `p` plans for the day on screen. */}
        {day.due.length > 0 && (
          <List>
            {day.due.map((task: TaskDTO) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onToggle={() => patch(task.id, { status: task.status === "done" ? "open" : "done" })}
                onRename={(title) => patch(task.id, { title })}
                onDue={(value) => patch(task.id, { dueDate: value })}
                onEstimate={(m) => patch(task.id, { estimateMinutes: m })}
                onPriority={(priority: TaskPriority) => patch(task.id, { priority })}
                onDrop={() => patch(task.id, { status: "dropped" })}
                onDelete={() => remove(task.id)}
                onPlanDate={(date) => planOn(task.id, date)}
                planFrom={day.date}
                compact
                draggable
                onDragStart={(e) => e.dataTransfer.setData(TASK_MIME, String(task.id))}
              />
            ))}
          </List>
        )}

        {/* Inside the working gate with the capacity span above: a non-working day is a quiet
          * gap, not a card that still finds something to say (F6) — see the comment at :86. */}
        {day.working && day.meetings.length === 0 && day.due.length === 0 && <p className="text-[12px] text-fg-faint m-0">Nothing yet</p>}
      </div>
    );
  }

  const noMeetings = week.days.every((d) => d.meetings.length === 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 min-[1100px]:grid-cols-7 gap-3 items-start">{week.days.map(column)}</div>
      {noMeetings && <p className="text-[13px] text-fg-faint m-0">No meetings this week</p>}
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </div>
  );
}
