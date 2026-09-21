"use client";

import { useRef, useState } from "react";
import type { TaskDTO, ProgressDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { quickParse } from "@/domain/tasks/quick-parse";
import { Button, Input } from "../ui";
import { TaskRow } from "./task-row";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";

function bySortOrder(a: TaskDTO, b: TaskDTO): number {
  return a.sortOrder - b.sortOrder;
}

/** Local mirror of `containerProgress`'s shape, derived from tasks already held in state so a
 * mutation's own optimistic update (and its confirmed response) can update the hero without a
 * round trip. */
function progressFrom(list: TaskDTO[]): ProgressDTO {
  const openTasks = list.filter((t) => t.status === "open").sort(bySortOrder);
  const doneCount = list.filter((t) => t.status === "done").length;
  const total = openTasks.length + doneCount;
  const percent = total ? Math.round((doneCount / total) * 100) : 0;
  const nextTask = openTasks[0] ? { id: openTasks[0].id, title: openTasks[0].title, dueDate: openTasks[0].dueDate } : null;
  return { open: openTasks.length, done: doneCount, total, percent, nextTask };
}

interface Props {
  containerId: number;
  initialTasks: TaskDTO[];
  initialProgress: ProgressDTO;
  onProgress?: (progress: ProgressDTO) => void;
  today: string;
}

export function TaskList({ containerId, initialTasks, onProgress, today }: Props) {
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const open = tasks.filter((t) => t.status === "open").sort(bySortOrder);
  const done = tasks.filter((t) => t.status === "done");

  function publishProgress(p: ProgressDTO) {
    onProgress?.(p);
  }

  /** Re-fetches the full task list and progress from the server; used to reconcile after a
   * reorder, whose response only carries the reordered open tasks. */
  async function refresh() {
    const res = await fetch(`/api/tasks?container=${containerId}&status=all`);
    if (!res.ok) return;
    const body = (await res.json()) as { tasks: TaskDTO[]; progress: ProgressDTO };
    setTasks(body.tasks);
    publishProgress(body.progress);
  }

  async function mutate(optimistic: (prev: TaskDTO[]) => TaskDTO[], request: () => Promise<Response>) {
    const prev = tasks;
    const next = optimistic(prev);
    setTasks(next);
    const res = await request();
    if (!res.ok) {
      setTasks(prev);
      setError(SAVE_ERROR);
      return;
    }
    setError(null);
    publishProgress(progressFrom(next));
  }

  async function addTask() {
    const value = draft.trim();
    if (!value) return;
    const parsed = quickParse(value);
    if (!parsed.title) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const body: Record<string, unknown> = { title: parsed.title, containerId };
      if (parsed.priority === "high") body.priority = "high";
      if (parsed.dueDate) body.dueDate = parsed.dueDate;
      const res = await fetch("/api/tasks", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (!res.ok) {
        setError(SAVE_ERROR);
        return;
      }
      const task = (await res.json()) as TaskDTO;
      const next = [...tasks, task];
      setTasks(next);
      setError(null);
      setDraft("");
      inputRef.current?.focus();
      publishProgress(progressFrom(next));
    } finally {
      submittingRef.current = false;
    }
  }

  function toggle(task: TaskDTO) {
    const status = task.status === "done" ? "open" : "done";
    void mutate(
      (prev) => prev.map((t) => (t.id === task.id ? { ...t, status, completedAt: status === "done" ? new Date().toISOString() : null } : t)),
      () => fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status }) }),
    );
  }

  function rename(id: number, title: string) {
    void mutate(
      (prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)),
      () => fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ title }) }),
    );
  }

  function setDue(id: number, dueDate: string | null) {
    void mutate(
      (prev) => prev.map((t) => (t.id === id ? { ...t, dueDate } : t)),
      () => fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ dueDate }) }),
    );
  }

  function setPriority(id: number, priority: TaskPriority) {
    void mutate(
      (prev) => prev.map((t) => (t.id === id ? { ...t, priority } : t)),
      () => fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ priority }) }),
    );
  }

  function drop(id: number) {
    void mutate(
      (prev) => prev.map((t) => (t.id === id ? { ...t, status: "dropped" } : t)),
      () => fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: "dropped" }) }),
    );
  }

  function remove(id: number) {
    void mutate(
      (prev) => prev.filter((t) => t.id !== id),
      () => fetch(`/api/tasks/${id}`, { method: "DELETE" }),
    );
  }

  function reorderTo(ids: number[]) {
    const prev = tasks;
    const order = new Map(ids.map((id, i) => [id, i]));
    setTasks(prev.map((t) => (order.has(t.id) ? { ...t, sortOrder: order.get(t.id)! } : t)));
    void (async () => {
      const res = await fetch("/api/tasks/reorder", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ containerId, ids }) });
      if (!res.ok) {
        setTasks(prev);
        setError(SAVE_ERROR);
        return;
      }
      setError(null);
      await refresh();
    })();
  }

  function move(id: number, dir: "up" | "down") {
    const idx = open.findIndex((t) => t.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= open.length) return;
    const ids = open.map((t) => t.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    reorderTo(ids);
  }

  function handleRowDrop(overId: number) {
    if (dragId === null || dragId === overId) {
      setDragId(null);
      return;
    }
    const ids = open.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    setDragId(null);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    reorderTo(ids);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              inputRef.current = e.currentTarget;
              void addTask();
            }
          }}
          placeholder="Add a task"
          aria-label="Add a task"
        />
        <p className="text-[11.5px] text-fg-faint">Enter to add. End with a day like fri or a date; start with ! for high priority.</p>
      </div>

      {open.length === 0 && done.length === 0 && <p className="text-fg-faint text-[13px]">No tasks yet. Add the first step above.</p>}

      {open.length > 0 && (
        <ul role="list" className="rounded-md border border-hairline bg-slate divide-y divide-hairline overflow-hidden">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              onToggle={() => toggle(task)}
              onRename={(title) => rename(task.id, title)}
              onDue={(value) => setDue(task.id, value)}
              onPriority={(priority) => setPriority(task.id, priority)}
              onDrop={() => drop(task.id)}
              onDelete={() => remove(task.id)}
              onMove={(dir) => move(task.id, dir)}
              draggable
              onDragStart={() => setDragId(task.id)}
              onDragOver={(e) => e.preventDefault()}
              onRowDrop={() => handleRowDrop(task.id)}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <Button variant="ghost" size="sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} className="self-start">
            {done.length} done
          </Button>
          {showDone && (
            <ul role="list" className="rounded-md border border-hairline bg-slate divide-y divide-hairline overflow-hidden">
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  onToggle={() => toggle(task)}
                  onRename={(title) => rename(task.id, title)}
                  onDue={(value) => setDue(task.id, value)}
                  onPriority={(priority) => setPriority(task.id, priority)}
                  onDrop={() => drop(task.id)}
                  onDelete={() => remove(task.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="text-danger text-[12.5px]">{error}</p>}
    </div>
  );
}
