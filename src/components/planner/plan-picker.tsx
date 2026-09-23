"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import { quickParse } from "@/domain/tasks/quick-parse";
import { formatMinutes } from "@/lib/capacity";
import { Chip } from "../ui";
import { formatShortDate } from "../tasks/task-row";

const JSON_HEADERS = { "content-type": "application/json" };
/** Before anything is typed, the list offers this many suggestions at most. */
const SUGGESTION_CAP = 8;
/** A search shows this many matches at most; a longer list is a narrower search away. */
const MATCH_CAP = 20;

export type PickerFilter = "due" | "inbox" | "projects" | "areas";
const FILTERS: { id: PickerFilter; label: string }[] = [
  { id: "due", label: "Due" },
  { id: "inbox", label: "Inbox" },
  { id: "projects", label: "Projects" },
  { id: "areas", label: "Areas" },
];

interface Option {
  id: string;
  task?: TaskDTO;
  /** The typed text, when the option is to make a task of it. */
  create?: string;
}
interface Group {
  label: string;
  options: Option[];
}

interface Props {
  day: PlannerDayDTO;
  today: string;
}

/**
 * The one way tasks reach the plan from inside it: a field that searches every open task, or
 * makes a new one of what was typed. Before anything is typed it suggests what is due and what
 * yesterday left; the chips browse one home at a time. The list opens under the field and
 * pushes the pane down rather than covering anything, and closes on Escape or a click away.
 */
export function PlanPicker({ day, today }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<PickerFilter | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const plannedIds = useMemo(() => new Set(day.plan.map((t) => t.id)), [day.plan]);
  const unplanned = (list: TaskDTO[]) => list.filter((t) => !plannedIds.has(t.id));

  const groups = useMemo<Group[]>(() => {
    const { sources } = day;
    const q = query.trim().toLowerCase();
    const homes: { label: string; tasks: TaskDTO[] }[] = [
      { label: "Inbox", tasks: unplanned(sources.inbox) },
      ...sources.projects.map((g) => ({ label: g.container.name, tasks: unplanned(g.tasks) })),
      ...sources.areas.map((g) => ({ label: g.container.name, tasks: unplanned(g.tasks) })),
    ];
    const toGroup = (label: string, tasks: TaskDTO[]): Group => ({ label, options: tasks.map((t) => ({ id: `task-${t.id}`, task: t })) });
    if (q) {
      const hits = homes.map((h) => ({ ...h, tasks: h.tasks.filter((t) => t.title.toLowerCase().includes(q)) })).filter((h) => h.tasks.length > 0);
      let left = MATCH_CAP;
      const out: Group[] = [];
      for (const h of hits) {
        if (left <= 0) break;
        out.push(toGroup(h.label, h.tasks.slice(0, left)));
        left -= h.tasks.length;
      }
      out.push({ label: "New", options: [{ id: "create", create: query.trim() }] });
      return out;
    }
    switch (filter) {
      case "due":
        return [toGroup("Due", unplanned([...sources.due.overdue, ...sources.due.today]))];
      case "inbox":
        return [toGroup("Inbox", unplanned(sources.inbox))];
      case "projects":
        return sources.projects.map((g) => toGroup(g.container.name, unplanned(g.tasks)));
      case "areas":
        return sources.areas.map((g) => toGroup(g.container.name, unplanned(g.tasks)));
      default: {
        const due = unplanned([...sources.due.overdue, ...sources.due.today]).slice(0, SUGGESTION_CAP);
        const left = unplanned(day.unfinishedYesterday).slice(0, Math.max(0, SUGGESTION_CAP - due.length));
        return [
          ...(due.length ? [toGroup("Due", due)] : []),
          ...(left.length ? [toGroup("From yesterday", left)] : []),
        ];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, query, filter, plannedIds]);

  const options = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const current = options[Math.min(active, Math.max(0, options.length - 1))];

  // A click away closes the list; the field keeps whatever was typed.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The ritual's "Open projects" and the ⌘/ key land here.
  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ filter?: PickerFilter; focus?: boolean }>).detail ?? {};
      if (detail.filter) setFilter(detail.filter);
      setOpen(true);
      setActive(0);
      if (detail.focus !== false) inputRef.current?.focus();
    }
    window.addEventListener("sb:plan-picker", onAsk);
    return () => window.removeEventListener("sb:plan-picker", onAsk);
  }, []);

  async function post(url: string, body: unknown): Promise<Response> {
    return fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  }

  /** Puts a task on the plan, or makes one first; the field empties and stays ready for the next. */
  async function choose(option: Option | undefined, close = false) {
    if (!option) return;
    try {
      let taskId = option.task?.id;
      if (option.create) {
        const parsed = quickParse(option.create);
        const body: Record<string, unknown> = { title: parsed.title, priority: parsed.priority, dueDate: parsed.dueDate };
        if (parsed.estimateMinutes !== null) body.estimateMinutes = parsed.estimateMinutes;
        const made = await post("/api/tasks", body);
        if (!made.ok) throw new Error("create");
        taskId = ((await made.json()) as { id: number }).id;
        window.dispatchEvent(new Event("sb:tasks-changed"));
      }
      const planned = await post("/api/plan", { date: day.date, taskId });
      if (!planned.ok) throw new Error("plan");
      setError(null);
      setQuery("");
      setActive(0);
      window.dispatchEvent(new Event("sb:plan-changed"));
      if (close) setOpen(false);
      else inputRef.current?.focus();
    } catch {
      setError("Could not add that to the plan");
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const n = options.length;
      if (n === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open && !query.trim()) {
        setOpen(true);
        return;
      }
      void choose(current ?? (query.trim() ? { id: "create", create: query.trim() } : undefined), e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  }

  const dayWord = day.date === today ? "today" : formatShortDate(`${day.date}T00:00:00`);
  const emptyLine = query.trim()
    ? null
    : filter === null
      ? "Nothing due and nothing left from yesterday. Pick a home, or type to search or create."
      : "Nothing left to plan here.";

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-fg-faint shrink-0" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={`Add a task for ${dayWord}`}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && current ? `${listId}-${current.id}` : undefined}
          placeholder="Add a task: type to search, or create"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          className="focus-ring flex-1 min-w-0 h-9 px-2 rounded-md bg-layer-2 border border-hairline text-[13.5px] text-fg placeholder:text-fg-faint"
        />
      </div>
      {open && (
        <>
          <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Browse">
            {FILTERS.map((f) => (
              <Chip
                key={f.id}
                aria-pressed={filter === f.id}
                active={filter === f.id}
                onClick={() => {
                  setFilter((v) => (v === f.id ? null : f.id));
                  setActive(0);
                  inputRef.current?.focus();
                }}
              >
                {f.label}
              </Chip>
            ))}
          </div>
          <div id={listId} role="listbox" aria-label="Tasks to plan" className="flex flex-col gap-2 max-h-80 overflow-y-auto">
            {options.length === 0 && emptyLine && <p className="text-[13px] text-fg-faint m-0 px-1">{emptyLine}</p>}
            {groups
              .filter((g) => g.options.length > 0)
              .map((g) => (
                <div key={g.label} role="group" aria-label={g.label} className="flex flex-col">
                  <span className="micro px-1 py-1">{g.label}</span>
                  {g.options.map((o) => {
                    const selected = current?.id === o.id;
                    return (
                      <div
                        key={o.id}
                        id={`${listId}-${o.id}`}
                        role="option"
                        aria-selected={selected}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => void choose(o, e.metaKey || e.ctrlKey)}
                        className={`flex items-center gap-2 h-9 px-2 rounded-md cursor-pointer text-[13.5px] ${selected ? "bg-layer-2 text-fg" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`}
                      >
                        {o.create ? (
                          <>
                            <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="truncate">Create &ldquo;{o.create}&rdquo;</span>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 min-w-0 truncate">{o.task!.title}</span>
                            {o.task!.dueDate && <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatShortDate(o.task!.dueDate)}</span>}
                            {o.task!.estimateMinutes !== null && <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatMinutes(o.task!.estimateMinutes)}</span>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </>
      )}
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </div>
  );
}
