"use client";

import { useEffect, useState, type DragEvent } from "react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { addDaysLocal } from "../activity/format";
import { Button, List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { count } from "./open-meeting";
import { PLAN_DRAG_MIME, TASK_DRAG_MIME } from "./sources-drawer";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, for the row's own "today" reckoning. */
  today: string;
  onRefresh: () => void;
}

/** The day's plan, and the only place tasks land: the drawer beside it holds everything else. */
export function PlanPane({ day, today, onRefresh }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState(false);

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

  /** Answers whether the request went through, so a two-step drop can stop after a failed first half. */
  async function send(url: string, method: string, body?: unknown, event = "sb:tasks-changed"): Promise<boolean> {
    const res = await fetch(url, { method, headers: body ? JSON_HEADERS : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      setError(SAVE_ERROR);
      return false;
    }
    setError(null);
    window.dispatchEvent(new Event(event));
    return true;
  }

  const patch = (id: number, body: Record<string, unknown>) => void send(`/api/tasks/${id}`, "PATCH", body);
  const remove = (id: number) => void send(`/api/tasks/${id}`, "DELETE");
  const unplan = (taskId: number) => void send("/api/plan", "DELETE", { date: day.date, taskId }, "sb:plan-changed");
  const reorder = (taskIds: number[]) => void send("/api/plan", "PATCH", { date: day.date, taskIds }, "sb:plan-changed");
  const carryOver = () => void send("/api/plan/carry-over", "POST", { from: addDaysLocal(day.date, -1), to: day.date }, "sb:plan-changed");

  /** A task dragged in from the drawer: planned first, then moved to where it was dropped. */
  async function planAt(taskId: number, index: number) {
    if (day.plan.some((t) => t.id === taskId)) return;
    if (!(await send("/api/plan", "POST", { date: day.date, taskId }, "sb:plan-changed"))) return;
    const ids = day.plan.map((t) => t.id);
    // The POST already put it last, so only a drop above the end needs an order.
    if (index >= ids.length) return;
    ids.splice(index, 0, taskId);
    await send("/api/plan", "PATCH", { date: day.date, taskIds: ids }, "sb:plan-changed");
  }

  function droppedTaskId(e: DragEvent<HTMLElement>): number | null {
    if (!e.dataTransfer?.types.includes(TASK_DRAG_MIME)) return null;
    e.preventDefault();
    return Number(e.dataTransfer.getData(TASK_DRAG_MIME)) || null;
  }

  function handleRowDrop(overId: number, e: DragEvent<HTMLLIElement>) {
    setOver(false);
    const incoming = droppedTaskId(e);
    if (incoming !== null) {
      // The list behind the row would otherwise plan it a second time, at the end.
      e.stopPropagation();
      const index = day.plan.findIndex((t) => t.id === overId);
      setDragId(null);
      if (index !== -1) void planAt(incoming, index);
      return;
    }
    const ids = day.plan.map((t) => t.id);
    const from = ids.indexOf(dragId ?? -1);
    const to = ids.indexOf(overId);
    setDragId(null);
    if (dragId === null || dragId === overId || from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    reorder(ids);
  }

  function row(task: TaskDTO) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        today={today}
        onToggle={() => patch(task.id, { status: task.status === "done" ? "open" : "done" })}
        onRename={(title) => patch(task.id, { title })}
        onDue={(value) => patch(task.id, { dueDate: value })}
        onPriority={(priority: TaskPriority) => patch(task.id, { priority })}
        onDrop={() => patch(task.id, { status: "dropped" })}
        onDelete={() => remove(task.id)}
        onPlan={() => unplan(task.id)}
        planned
        draggable
        onDragStart={(e) => {
          setDragId(task.id);
          // The drawer accepts this one to take the task off the plan again.
          e.dataTransfer.setData(PLAN_DRAG_MIME, String(task.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => e.preventDefault()}
        onRowDrop={(e) => handleRowDrop(task.id, e)}
      />
    );
  }

  return (
    <section className="pane p-4 flex flex-col gap-3">
      <span className="micro">Plan</span>

      {day.unfinishedYesterday.length > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-layer-2 border border-hairline px-3 py-2">
          <span className="text-[12.5px] text-fg-muted flex-1 min-w-0">{count(day.unfinishedYesterday.length, "unfinished task")} from yesterday</span>
          <Button size="sm" onClick={carryOver}>
            Carry over
          </Button>
        </div>
      )}

      {day.plan.length === 0 && <p className="text-[13px] text-fg-faint m-0">Nothing planned. Drag a task in from the sources beside this, or use Plan for today on any task</p>}

      <List
        aria-label="Plan"
        className={`border rounded-md transition-colors duration-100 ${over ? "border-violet" : "border-transparent"} ${day.plan.length === 0 ? "min-h-11" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.includes(TASK_DRAG_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          // Moving between two rows leaves one and enters another: the list itself is still under the cursor.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          setOver(false);
          const incoming = droppedTaskId(e);
          if (incoming !== null) void planAt(incoming, day.plan.length);
        }}
      >
        {day.plan.map(row)}
      </List>

      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
