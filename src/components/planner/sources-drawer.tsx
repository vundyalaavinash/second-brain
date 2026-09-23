"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, Plus } from "lucide-react";
import type { PlannerDayDTO, SourceGroupDTO, TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { Chip, Input, List } from "../ui";
import { TaskRow } from "../tasks/task-row";
import { useDrawerTab, type DrawerTab } from "./use-drawer-tab";

/** A task dragged out of the drawer, to be dropped on the plan. */
export const TASK_DRAG_MIME = "application/x-sb-task";
/** A task dragged off the plan, to be dropped on the drawer. */
export const PLAN_DRAG_MIME = "application/x-sb-plan";
const JSON_HEADERS = { "content-type": "application/json" };
const PANEL_ID = "sources-panel";
const tabId = (tab: DrawerTab) => `sources-tab-${tab}`;
const EMPTY = "text-[13px] text-fg-faint m-0 px-1";
const TABS: { id: DrawerTab; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "due", label: "Due" },
  { id: "projects", label: "Projects" },
  { id: "areas", label: "Areas" },
  { id: "search", label: "Search" },
];

interface Props {
  day: PlannerDayDTO;
  today: string;
  onRefresh: () => void;
}

/** The day's own name in the add button: "today" on today, the date otherwise. */
function dayWord(date: string, today: string): string {
  return date === today ? "today" : date;
}

/** A group's tasks that are not on the plan yet: what the tab counts are counting. */
function open(tasks: TaskDTO[], plannedIds: Set<number>): number {
  return tasks.filter((t) => !plannedIds.has(t.id)).length;
}

function groupCount(groups: SourceGroupDTO[], plannedIds: Set<number>): number {
  return groups.reduce((n, g) => n + open(g.tasks, plannedIds), 0);
}

/**
 * Every open task by where it lives, one click or one drag away from the plan. Rows are the
 * app's task rows in their compact form with an add button in front; a planned task keeps
 * its row, dimmed, with a check that takes it off again.
 */
export function SourcesDrawer({ day, today }: Props) {
  const { sources } = day;
  const plannedIds = useMemo(() => new Set(day.plan.map((t) => t.id)), [day.plan]);
  const dueCount = open([...sources.due.overdue, ...sources.due.today], plannedIds);
  const [tab, setTab] = useDrawerTab(dueCount > 0 ? "due" : "inbox");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bumped by a drawer event asking for focus; the effect below lands it once the tab has rendered.
  const [focusToken, setFocusToken] = useState(0);
  const wantFocus = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDrawer(e: Event) {
      const detail = (e as CustomEvent<{ tab?: DrawerTab; focus?: boolean }>).detail ?? {};
      if (detail.tab) setTab(detail.tab);
      if (detail.focus) {
        wantFocus.current = true;
        setFocusToken((n) => n + 1);
      }
    }
    window.addEventListener("sb:planner-drawer", onDrawer);
    return () => window.removeEventListener("sb:planner-drawer", onDrawer);
  }, [setTab]);

  // The rows of the tab the event asked for exist by the time this runs, so the first one takes focus.
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    listRef.current?.querySelector<HTMLButtonElement>("button[data-plan]")?.focus();
  }, [focusToken, tab]);

  async function send(method: "POST" | "DELETE", taskId: number) {
    const res = await fetch("/api/plan", { method, headers: JSON_HEADERS, body: JSON.stringify({ date: day.date, taskId }) });
    if (!res.ok) {
      setError("Could not change the plan");
      return;
    }
    setError(null);
    // The plan pane listens for this and reloads the day for both of us.
    window.dispatchEvent(new Event("sb:plan-changed"));
  }
  const patch = async (id: number, body: Record<string, unknown>) => {
    const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (res.ok) window.dispatchEvent(new Event("sb:tasks-changed"));
    else setError("Could not save that change");
  };

  function onAddKey(e: KeyboardEvent<HTMLButtonElement>, taskId: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-plan]") ?? []);
    const next = buttons[buttons.indexOf(e.currentTarget) + 1];
    void send("POST", taskId);
    next?.focus();
  }

  function row(task: TaskDTO) {
    const planned = plannedIds.has(task.id);
    const label = planned ? `Take ${task.title} off the plan` : `Plan ${task.title} for ${dayWord(day.date, today)}`;
    return (
      <TaskRow
        key={task.id}
        task={task}
        today={today}
        compact
        planned={planned}
        className={planned ? "opacity-50" : ""}
        leading={
          <button
            type="button"
            data-plan
            aria-label={label}
            className={`focus-ring shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-100 ${
              planned ? "bg-violet text-on-violet" : "border border-hairline text-fg-muted hover:text-fg hover:border-hairline-strong"
            }`}
            onClick={() => void send(planned ? "DELETE" : "POST", task.id)}
            onKeyDown={(e) => {
              if (!planned) onAddKey(e, task.id);
            }}
          >
            {planned ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Plus className="w-3.5 h-3.5" aria-hidden />}
            <span className="sr-only">{label}</span>
          </button>
        }
        draggable={!planned}
        onDragStart={(e: DragEvent<HTMLLIElement>) => {
          e.dataTransfer.setData(TASK_DRAG_MIME, String(task.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onToggle={() => void patch(task.id, { status: task.status === "done" ? "open" : "done" })}
        onRename={(title) => void patch(task.id, { title })}
        onDue={(value) => void patch(task.id, { dueDate: value })}
        onPriority={(priority: TaskPriority) => void patch(task.id, { priority })}
        onDrop={() => void patch(task.id, { status: "dropped" })}
        onDelete={() => void fetch(`/api/tasks/${task.id}`, { method: "DELETE" }).then(() => window.dispatchEvent(new Event("sb:tasks-changed")))}
        onPlan={() => void send(planned ? "DELETE" : "POST", task.id)}
        planLabel={day.date === today ? undefined : "Plan for this day"}
      />
    );
  }

  function groups(list: SourceGroupDTO[], emptyText: string) {
    if (list.length === 0) return <p className={EMPTY}>{emptyText}</p>;
    // A container with nothing left in it sinks below the ones that still want work.
    const ordered = [...list].sort((a, b) => Number(b.tasks.length > 0) - Number(a.tasks.length > 0));
    return ordered.map((g) => (
      <details key={g.container.id} role="group" open={g.tasks.length > 0} className="flex flex-col gap-1">
        <summary className="focus-ring cursor-pointer flex items-center gap-2 rounded-sm px-1 py-1">
          <span className="font-doc text-[15px] text-fg">{g.container.name}</span>
          <span className="font-mono text-[11px] text-fg-faint">{open(g.tasks, plannedIds)}</span>
        </summary>
        {g.tasks.length > 0 && <List>{g.tasks.map(row)}</List>}
      </details>
    ));
  }

  function searchResults() {
    const q = query.trim().toLowerCase();
    if (!q) return <p className={EMPTY}>Type to search every open task</p>;
    const homes: { key: string; name: string; tasks: TaskDTO[] }[] = [
      { key: "inbox", name: "Inbox", tasks: sources.inbox },
      ...[...sources.projects, ...sources.areas].map((g) => ({ key: `${g.container.kind}:${g.container.id}`, name: g.container.name, tasks: g.tasks })),
    ]
      .map((h) => ({ ...h, tasks: h.tasks.filter((t) => t.title.toLowerCase().includes(q)) }))
      .filter((h) => h.tasks.length > 0);
    if (homes.length === 0) return <p className={EMPTY}>Nothing matches</p>;
    return homes.map((h) => (
      <div key={h.key} className="flex flex-col gap-1">
        <span className="micro px-1">{h.name}</span>
        <List>{h.tasks.map(row)}</List>
      </div>
    ));
  }

  function body() {
    switch (tab) {
      case "inbox":
        return sources.inbox.length ? <List>{sources.inbox.map(row)}</List> : <p className={EMPTY}>Nothing in the inbox</p>;
      case "due": {
        const due = [...sources.due.overdue, ...sources.due.today];
        return due.length ? <List>{due.map(row)}</List> : <p className={EMPTY}>Nothing due</p>;
      }
      case "projects":
        return groups(sources.projects, "No active projects");
      case "areas":
        return groups(sources.areas, "No active areas");
      case "search":
        return (
          <>
            <Input type="search" size="sm" aria-label="Search open tasks" placeholder="Search open tasks" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            {searchResults()}
          </>
        );
    }
  }

  const counts: Record<DrawerTab, number | null> = {
    inbox: open(sources.inbox, plannedIds),
    due: dueCount,
    projects: groupCount(sources.projects, plannedIds),
    areas: groupCount(sources.areas, plannedIds),
    search: null,
  };

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length].id);
    else if (e.key === "ArrowLeft") setTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
    else return;
    e.preventDefault();
    const tablist = e.currentTarget;
    requestAnimationFrame(() => (tablist.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
  }

  return (
    <aside
      className="pane p-3 flex flex-col gap-3 min-h-[240px]"
      aria-label="Sources"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PLAN_DRAG_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(PLAN_DRAG_MIME)) return;
        e.preventDefault();
        const id = Number(e.dataTransfer.getData(PLAN_DRAG_MIME));
        if (id) void send("DELETE", id);
      }}
    >
      <div role="tablist" aria-label="Sources" className="flex items-center gap-1 flex-wrap" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <Chip
            key={t.id}
            id={tabId(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={PANEL_ID}
            tabIndex={tab === t.id ? 0 : -1}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {/* Label and count are one string: a lone "Inbox" text node would collide with the
                search results' own Inbox heading. */}
            {counts[t.id] === null ? t.label : `${t.label} ${counts[t.id]}`}
          </Chip>
        ))}
      </div>
      <div ref={listRef} role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} className="flex flex-col gap-2">
        {body()}
      </div>
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </aside>
  );
}
