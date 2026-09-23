"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { PlannerDayDTO } from "@/lib/dto";
import { addDaysLocal } from "../activity/format";
import { Button } from "../ui";
import { count } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };
export const ritualDoneKey = (date: string) => `sb:ritual-done:${date}`;

type StepId = "carry" | "due" | "projects";

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, so the copy only says "today" when it means it. */
  today: string;
  onDone: () => void;
}

/**
 * Three steps for an empty morning: carry over, plan what is due, pick from projects. The
 * strip is an ordered list; the current step carries aria-current, finished ones a check.
 */
export function RitualStrip({ day, today, onDone }: Props) {
  const dueTasks = [...day.sources.due.overdue, ...day.sources.due.today];
  const steps: StepId[] = [...(day.unfinishedYesterday.length ? (["carry"] as StepId[]) : []), "due", "projects"];
  const [finished, setFinished] = useState<StepId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = steps.find((s) => !finished.includes(s));

  function finish(step: StepId) {
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
    if (await post("/api/plan/carry-over", { from: addDaysLocal(day.date, -1), to: day.date })) {
      window.dispatchEvent(new Event("sb:plan-changed"));
      finish("carry");
    }
  }
  async function planAll() {
    for (const t of dueTasks) if (!(await post("/api/plan", { date: day.date, taskId: t.id }))) return;
    window.dispatchEvent(new Event("sb:plan-changed"));
    finish("due");
  }
  function openProjects() {
    window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects", focus: true } }));
  }

  const copy: Record<StepId, { title: string; detail: string; action: { label: string; run: () => void }; skipLabel: string }> = {
    carry: { title: "Carry over", detail: `${count(day.unfinishedYesterday.length, "unfinished task")} from yesterday`, action: { label: "Carry over", run: () => void carryOver() }, skipLabel: "Skip" },
    due: { title: "Review what is due", detail: `${day.sources.due.overdue.length} overdue, ${day.sources.due.today.length} due ${day.date === today ? "today" : "that day"}`, action: { label: "Plan all", run: () => void planAll() }, skipLabel: "Skip" },
    projects: { title: "Pick from projects", detail: "Open the Projects tab and add what moves them forward", action: { label: "Open projects", run: openProjects }, skipLabel: "Done" },
  };

  return (
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
                <Button size="sm" variant="primary" onClick={c.action.run} disabled={step === "due" && dueTasks.length === 0}>
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
      {error && <li className="text-danger text-[12.5px] py-1">{error}</li>}
    </ol>
  );
}
