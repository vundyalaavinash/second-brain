"use client";

import { useEffect, useState } from "react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { addDaysLocal } from "../activity/format";
import { Button, List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { count } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, for the row's own "today" reckoning. */
  today: string;
  onRefresh: () => void;
}

export function PlanPane({ day, today, onRefresh }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const due = [...day.due.overdue, ...day.due.today];

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
  const plan = (taskId: number) => void send("/api/plan", "POST", { date: day.date, taskId }, "sb:plan-changed");
  const unplan = (taskId: number) => void send("/api/plan", "DELETE", { date: day.date, taskId }, "sb:plan-changed");
  const reorder = (taskIds: number[]) => void send("/api/plan", "PATCH", { date: day.date, taskIds }, "sb:plan-changed");
  const carryOver = () => void send("/api/plan/carry-over", "POST", { from: addDaysLocal(day.date, -1), to: day.date }, "sb:plan-changed");

  function handleRowDrop(overId: number) {
    const ids = day.plan.map((t) => t.id);
    const from = ids.indexOf(dragId ?? -1);
    const to = ids.indexOf(overId);
    setDragId(null);
    if (dragId === null || dragId === overId || from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    reorder(ids);
  }

  function row(task: TaskDTO, planned: boolean) {
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
        onPlan={() => (planned ? unplan(task.id) : plan(task.id))}
        planLabel={day.date === today ? undefined : "Plan for this day"}
        planned={planned}
        draggable={planned}
        onDragStart={planned ? () => setDragId(task.id) : undefined}
        onDragOver={planned ? (e) => e.preventDefault() : undefined}
        onRowDrop={planned ? () => handleRowDrop(task.id) : undefined}
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

      {day.plan.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">Nothing planned. Use Plan for today on any task, or add one below with +</p>
      ) : (
        <List>{day.plan.map((t) => row(t, true))}</List>
      )}

      <span className="micro mt-1">Due</span>
      {due.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">Nothing due</p>
      ) : (
        <List>{due.map((t) => row(t, false))}</List>
      )}

      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
