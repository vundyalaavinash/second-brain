"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityMeetingDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { formatClock, formatDayHeading } from "@/components/activity/format";
import { Crumb } from "@/components/shell/crumb";
import { List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { partitionDue } from "./partition";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";

interface Props {
  today: string;
  tasks: TaskDTO[];
  meetings: ActivityMeetingDTO[];
}

/** "Tuesday 22 September" split into the weekday and the rest, so the header can stack them. */
function headingParts(day: string): { weekday: string; date: string } {
  const [weekday, ...rest] = formatDayHeading(day).split(" ");
  return { weekday, date: rest.join(" ") };
}

export function TodayPage({ today, tasks: initialTasks, meetings }: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tasks?status=open");
    if (!res.ok) return;
    const body = (await res.json()) as { tasks: TaskDTO[] };
    setTasks(body.tasks);
  }, []);

  // Anything that adds or changes a task elsewhere (the prompt bar included) says so.
  useEffect(() => {
    function onChanged() {
      void refresh();
    }
    window.addEventListener("sb:tasks-changed", onChanged);
    return () => window.removeEventListener("sb:tasks-changed", onChanged);
  }, [refresh]);

  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (!res.ok) {
        setError(SAVE_ERROR);
        return;
      }
      setError(null);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(SAVE_ERROR);
        return;
      }
      setError(null);
      await refresh();
    },
    [refresh],
  );

  const { overdue, today: dueToday } = partitionDue(tasks, today);
  const { weekday, date } = headingParts(today);
  const numeral = String(Number(today.slice(8, 10)));
  const due = [...overdue, ...dueToday];

  function row(task: TaskDTO) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        today={today}
        onToggle={() => void patch(task.id, { status: task.status === "done" ? "open" : "done" })}
        onRename={(title) => void patch(task.id, { title })}
        onDue={(value) => void patch(task.id, { dueDate: value })}
        onPriority={(priority: TaskPriority) => void patch(task.id, { priority })}
        onDrop={() => void patch(task.id, { status: "dropped" })}
        onDelete={() => void remove(task.id)}
      />
    );
  }

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-6">
      <Crumb title="Today" />
      <header className="flex items-end gap-4">
        <span className="font-doc text-[96px] leading-[0.9] font-medium">{numeral}</span>
        <span className="flex flex-col pb-1">
          <span className="text-[18px]">{weekday}</span>
          <span className="text-fg-muted">{date}</span>
        </span>
        <span className="ml-auto font-mono text-[12px] text-fg-muted pb-2">
          {due.length === 0 ? "Nothing due today" : `${dueToday.length} due today, ${overdue.length} overdue`}
        </span>
      </header>

      <div className="grid grid-cols-1 min-[1100px]:grid-cols-2 gap-6">
        <section className="pane p-4 flex flex-col gap-3">
          <span className="micro">Due</span>
          {due.length === 0 ? (
            <p className="text-[13px] text-fg-faint m-0">Nothing due. Add a task below with +</p>
          ) : (
            <List>{due.map(row)}</List>
          )}
          {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
        </section>

        <section className="pane p-4 flex flex-col gap-3">
          <span className="micro">Meetings</span>
          {meetings.length === 0 ? (
            <p className="text-[13px] text-fg-faint m-0">No meetings today</p>
          ) : (
            <List>
              {[...meetings]
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                .map((m) => (
                  <li key={m.id} className="hairline-row flex items-center gap-3 h-11 text-[13.5px]">
                    <span className="font-mono text-[11px] text-fg-muted shrink-0">{formatClock(m.startsAt)}</span>
                    <span className="truncate">{m.title}</span>
                  </li>
                ))}
            </List>
          )}
        </section>
      </div>
    </div>
  );
}
