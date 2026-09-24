"use client";

import { useEffect, useRef, useState } from "react";
import { REVIEW_STEPS, type ReviewStep } from "@/db/enums";
import type { ReviewAnswersDTO, ReviewDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { Button, PageHeader } from "../ui";
import { StepNav } from "./step-nav";
import { StepClear } from "./step-clear";
import { StepBack } from "./step-back";
import { StepGoals } from "./step-goals";
import { StepAhead } from "./step-ahead";

const JSON_HEADERS = { "content-type": "application/json" };

interface Drafts {
  clear: string;
  back: string;
  goals: Record<string, string>;
  ahead: string;
}

function draftsFrom(answers: ReviewAnswersDTO): Drafts {
  return { clear: answers.clear ?? "", back: answers.back ?? "", goals: answers.goals ?? {}, ahead: answers.ahead ?? "" };
}

/**
 * The four panes, one at a time: the payload the server assembled, the step in view, and a
 * draft per step that a save in flight never overwrites. Nothing is saved on a keystroke —
 * only on leaving the step that holds it — and a step's own save requests run one at a time, in
 * order, each reading the draft as it stands the moment it actually runs rather than the moment
 * it was queued, so a second save started while the first is still in flight cannot land an
 * older answer over a newer one.
 */
export function ReviewPage({ initial }: { initial: ReviewDTO }) {
  const [payload, setPayload] = useState(initial);
  const [step, setStep] = useState<ReviewStep>(initial.step);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(initial.answers));
  const [error, setError] = useState<string | null>(null);

  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const chains = useRef<Record<ReviewStep, Promise<void>>>({ clear: Promise.resolve(), back: Promise.resolve(), goals: Promise.resolve(), ahead: Promise.resolve() });

  function saveStep(target: ReviewStep): Promise<void> {
    const run = async () => {
      try {
        const res = await fetch("/api/review", {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ week: payload.week, step: target, value: draftsRef.current[target] }),
        });
        if (!res.ok) {
          setError("Could not save. It will try again the next time you leave this step.");
          return;
        }
        setError(null);
        setPayload((await res.json()) as ReviewDTO);
      } catch {
        setError("Could not save. It will try again the next time you leave this step.");
      }
    };
    const next = chains.current[target].then(run, run);
    chains.current[target] = next;
    return next;
  }

  function goTo(next: ReviewStep) {
    if (next === step) return;
    void saveStep(step);
    setStep(next);
  }

  /** Everything that mutates a task or the plan from here reloads the whole payload, rather
   * than guess which figure it moved — the same rule `PlanPane`'s own refresh follows. */
  async function refresh() {
    const res = await fetch(`/api/review?week=${payload.week}`).catch(() => null);
    if (res?.ok) setPayload((await res.json()) as ReviewDTO);
  }

  async function carry(taskId: number) {
    await fetch("/api/plan", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ date: payload.ahead.week, taskId }) }).catch(() => null);
    window.dispatchEvent(new Event("sb:plan-changed"));
    await refresh();
  }

  async function drop(taskId: number) {
    await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: "dropped" }) }).catch(() => null);
    window.dispatchEvent(new Event("sb:tasks-changed"));
    await refresh();
  }

  async function plan(taskIds: number[]) {
    const res = await fetch("/api/review/plan", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ week: payload.ahead.week, taskIds }) }).catch(() => null);
    if (!res?.ok) {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Could not plan those tasks." } }));
      return;
    }
    const body = (await res.json()) as { planned: number };
    window.dispatchEvent(new Event("sb:plan-changed"));
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: `Planned ${body.planned} task${body.planned === 1 ? "" : "s"} for next week.` } }));
  }

  const idx = REVIEW_STEPS.indexOf(step);

  return (
    <div className="w-full max-w-3xl mx-auto px-6 lg:px-8 pt-8 pb-16 flex flex-col gap-5">
      <PageHeader title={payload.label} meta={payload.savedAt ? `Saved ${relativeTime(payload.savedAt)}` : "Not saved yet"} />

      <StepNav current={step} answers={payload.answers} onSelect={goTo} />

      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}

      <div className="min-w-0">
        {step === "clear" && (
          <StepClear leftover={payload.clear.leftover} value={drafts.clear} onChange={(value) => setDrafts((d) => ({ ...d, clear: value }))} onCarry={carry} onDrop={drop} />
        )}
        {step === "back" && <StepBack back={payload.back} value={drafts.back} onChange={(value) => setDrafts((d) => ({ ...d, back: value }))} />}
        {step === "goals" && (
          <StepGoals
            goals={payload.goals}
            today={payload.today}
            value={drafts.goals}
            onChange={(goalId, note) => setDrafts((d) => ({ ...d, goals: { ...d.goals, [goalId]: note } }))}
          />
        )}
        {step === "ahead" && <StepAhead ahead={payload.ahead} value={drafts.ahead} onChange={(value) => setDrafts((d) => ({ ...d, ahead: value }))} onPlan={plan} />}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="secondary" size="sm" disabled={idx === 0} onClick={() => goTo(REVIEW_STEPS[idx - 1])}>
          Back
        </Button>
        <Button variant="primary" size="sm" disabled={idx === REVIEW_STEPS.length - 1} onClick={() => goTo(REVIEW_STEPS[idx + 1])}>
          Next
        </Button>
      </div>
    </div>
  );
}
