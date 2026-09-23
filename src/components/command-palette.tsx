"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM, type IconName } from "./nav";
import { Icon } from "./icons";
import { Kbd } from "./ui";
import { todayLocal } from "./activity/format";
import type { ContainerDTO, TaskDTO } from "@/lib/dto";

interface Command {
  id: string;
  label: string;
  /** A muted word before the label saying what kind of thing it is. */
  prefix?: string;
  hint?: string;
  iconName?: IconName;
  run: () => void;
}

/** Below this many characters a title match says nothing, so the Plan section stays away. */
const PLAN_MIN_QUERY = 2;
const PLAN_LIMIT = 6;

const KINDS = [
  { kind: "project", prefix: "Project", iconName: "project" as IconName },
  { kind: "area", prefix: "Area", iconName: "area" as IconName },
];

function matching(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [jumps, setJumps] = useState<Command[]>([]);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () =>
      [...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM].map((n) => ({
        id: n.href,
        label: n.label,
        hint: n.shortcut,
        iconName: n.icon,
        run: () => router.push(n.href),
      })),
    [router],
  );

  // The open containers, read when the palette opens so a rename or an archive elsewhere is
  // never stale by more than one opening.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      try {
        const lists = await Promise.all(
          KINDS.map(async ({ kind, prefix, iconName }) => {
            const res = await fetch(`/api/containers?kind=${kind}&status=active`, { cache: "no-store" });
            if (!res.ok) return [];
            const containers = (await res.json()) as ContainerDTO[];
            return containers.map((c) => ({
              id: `/c/${c.slug}`,
              label: c.name,
              prefix,
              iconName,
              run: () => router.push(`/c/${c.slug}`),
            }));
          }),
        );
        if (alive) setJumps(lists.flat());
      } catch {
        /* offline: keep whatever the last opening found */
      }
      try {
        const res = await fetch("/api/tasks?status=open", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { tasks: TaskDTO[] };
        if (alive) setTasks(body.tasks);
      } catch {
        /* offline: the Plan section simply offers nothing */
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [open, router]);

  const filteredViews = useMemo(() => matching(commands, query), [commands, query]);
  const filteredJumps = useMemo(() => matching(jumps, query), [jumps, query]);

  // An open task is only worth offering once the query is specific enough to mean one: a
  // single letter would put six of them under every view the palette already lists.
  const plans = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < PLAN_MIN_QUERY) return [];
    return tasks
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, PLAN_LIMIT)
      .map((t) => ({
        id: `plan:${t.id}`,
        label: t.title,
        // No prefix: the "Plan" heading above these rows already says what they do.
        iconName: "planner" as IconName,
        run: () => {
          void fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: todayLocal(), taskId: t.id }) }).then((res) => {
            if (!res.ok) return;
            window.dispatchEvent(new Event("sb:plan-changed"));
            window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Planned for today" } }));
          });
        },
      }));
  }, [tasks, query]);

  const filtered = useMemo(() => [...filteredViews, ...filteredJumps, ...plans], [filteredViews, filteredJumps, plans]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    function onOpen() {
      setOpen(true);
      setQuery("");
      setIndex(0);
    }
    window.addEventListener("sb:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sb:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function choose(c: Command) {
    setOpen(false);
    c.run();
  }

  function row(c: Command, i: number) {
    return (
      <li
        key={c.id}
        onMouseEnter={() => setIndex(i)}
        onClick={() => choose(c)}
        className={`mx-1.5 px-2.5 h-10 rounded-md flex items-center gap-3 cursor-pointer ${i === index ? "bg-layer-2 text-fg" : "text-fg-muted"}`}
      >
        {c.iconName && <Icon name={c.iconName} className="w-4 h-4" />}
        <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
          {c.prefix && <span className="text-fg-faint shrink-0">{c.prefix}</span>}
          <span className="truncate">{c.label}</span>
        </span>
        {c.hint && <Kbd>{c.hint}</Kbd>}
      </li>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[16vh]" onClick={() => setOpen(false)}>
      <div className="panel w-[560px] max-w-[92vw] rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 h-12 px-4 border-b border-hairline focus-within:border-hairline-strong">
          <Search className="w-4 h-4 text-fg-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtered[index]) {
                choose(filtered[index]);
              }
            }}
            placeholder="Jump to a view or run a command"
            className="flex-1 bg-transparent outline-none text-[14px]"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 && <li className="px-4 py-3 text-[13px] text-fg-faint">No matching commands.</li>}
          {filteredViews.map(row)}
          {filteredJumps.length > 0 && <li className="micro px-4 pt-3 pb-1">Jump to</li>}
          {filteredJumps.map((c, i) => row(c, filteredViews.length + i))}
          {plans.length > 0 && <li className="micro px-4 pt-3 pb-1">Plan</li>}
          {plans.map((c, i) => row(c, filteredViews.length + filteredJumps.length + i))}
        </ul>
      </div>
    </div>
  );
}
