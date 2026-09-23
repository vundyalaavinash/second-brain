"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import { addDaysLocal } from "../activity/format";
import { Button } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };
export const ritualDoneKey = (date: string) => `sb:ritual-done:${date}`;

type StepId = "carry" | "due" | "projects";

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, so the copy only says "today" when it means it. */
  today: string;
  /** Fired the first time any step acts or is skipped, so the pane keeps the strip up. */
  onStarted: () => void;
  onDone: () => void;
}

/**
 * Steps for an empty morning: carry over, plan what is due, pick from projects. Each step is
 * left out when it has nothing to offer, so the strip runs one to three steps long. It is an
 * ordered list; the current step carries aria-current, finished ones a check.
 */
/** Overdue first, oldest deadline leading, then what falls due on the day itself. */
function dueInOrder(day: PlannerDayDTO): TaskDTO[] {
  return [...[...day.sources.due.overdue].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")), ...day.sources.due.today];
}

/**
 * The steps a morning has to offer. Each one is left out when it has nothing behind it, so a
 * day with no leftovers, nothing due and no project work has no ritual at all.
 */
export function ritualSteps(day: PlannerDayDTO): StepId[] {
  const planned = new Set(day.plan.map((t) => t.id));
  const projectWork = day.sources.projects.some((g) => g.tasks.some((t) => !planned.has(t.id)));
  return [
    ...(day.unfinishedYesterday.length ? (["carry"] as StepId[]) : []),
    ...(dueInOrder(day).length ? (["due"] as StepId[]) : []),
    ...(projectWork ? (["projects"] as StepId[]) : []),
  ];
}

export function RitualStrip({ day, today, onStarted, onDone }: Props) {
  // The morning the strip opened on, latched: acting on a step reloads the day, and a step
  // whose work is now done must strike itself through rather than disappear mid-walk.
  const [morning] = useState(() => ({
    dueTasks: dueInOrder(day),
    carried: day.unfinishedYesterday.length,
    overdue: day.sources.due.overdue.length,
    dueToday: day.sources.due.today.length,
    steps: ritualSteps(day),
  }));
  const { dueTasks, steps } = morning;
  const [finished, setFinished] = useState<StepId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = steps.find((s) => !finished.includes(s));

  function finish(step: StepId) {
    onStarted();
    const next = [...finished, step];
    setFinished(next);
    if (steps.every((s) => next.includes(s))) {
      try {
        localStorage.setItem(ritualDoneKey(day.date), "1");
      } catch {
        /* the strip just returns next time */
      }
      onDone();
    }
  }

  async function post(url: string, body: unknown): Promise<boolean> {
    const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (!res.ok) setError("Could not change the plan");
    return res.ok;
  }

  async function carryOver() {
    onStarted();
    if (await post("/api/plan/carry-over", { from: addDaysLocal(day.date, -1), to: day.date })) {
      window.dispatchEvent(new Event("sb:plan-changed"));
      finish("carry");
    }
  }
  async function planAll() {
    onStarted();
    for (const t of dueTasks) if (!(await post("/api/plan", { date: day.date, taskId: t.id }))) return;
    window.dispatchEvent(new Event("sb:plan-changed"));
    finish("due");
  }
  function openProjects() {
    onStarted();
    window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects", focus: true } }));
  }

  const copy: Record<StepId, { title: string; detail: string; action: { label: string; run: () => void }; skipLabel: string }> = {
    carry: { title: "Carry over", detail: `${morning.carried} unfinished from yesterday`, action: { label: "Carry over", run: () => void carryOver() }, skipLabel: "Skip" },
    due: { title: "Review what is due", detail: `${morning.overdue} overdue, ${morning.dueToday} due ${day.date === today ? "today" : "that day"}`, action: { label: "Plan all", run: () => void planAll() }, skipLabel: "Skip" },
    projects: { title: "Pick from projects", detail: "Open the Projects tab and add what moves them forward", action: { label: "Open projects", run: openProjects }, skipLabel: "Done" },
  };

  return (
    <>
      <ol aria-label="Plan the day" className="flex flex-col m-0 p-0 list-none">
        {steps.map((step, i) => {
          const done = finished.includes(step);
          const active = step === current;
          const c = copy[step];
          return (
            <li key={step} aria-current={active ? "step" : undefined} className={`hairline-row flex items-center gap-3 py-2 ${active ? "text-fg" : "text-fg-faint"}`}>
              <span className="font-mono text-[11px] w-4 shrink-0">{done ? <Check className="w-3.5 h-3.5 text-violet" aria-hidden /> : i + 1}</span>
              <span className={`flex-1 min-w-0 text-[13px] ${done ? "line-through" : ""}`}>
                {c.title}
                <span className="text-fg-faint"> · {c.detail}</span>
              </span>
              {active && (
                <span className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="primary" onClick={c.action.run}>
                    {c.action.label}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => finish(step)}>
                    {c.skipLabel}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="status" className="text-danger text-[12.5px] m-0">
          {error}
        </p>
      )}
    </>
  );
}
