"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REVIEW_STEPS, type ReviewStep } from "@/db/enums";
import type { ReviewAnswersDTO, ReviewDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { Button, PageHeader } from "../ui";
import { STEP_LABELS, StepNav } from "./step-nav";
import { StepClear } from "./step-clear";
import { StepBack } from "./step-back";
import { StepGoals } from "./step-goals";
import { StepAhead } from "./step-ahead";

const JSON_HEADERS = { "content-type": "application/json" };

/** What is true, and only what is true: the draft is still on screen, but the last attempt to
 * store it did not land. There is no promise of an automatic retry here — the next thing that
 * actually retries it (leaving this step again, or leaving the page) is what makes it true. */
export const SAVE_ERROR = "Not saved — this answer is still on screen, not yet stored.";

type DraftValue = string | Record<string, string>;

interface Drafts {
  clear: string;
  back: string;
  goals: Record<string, string>;
  ahead: string;
}

function draftsFrom(answers: ReviewAnswersDTO): Drafts {
  return { clear: answers.clear ?? "", back: answers.back ?? "", goals: answers.goals ?? {}, ahead: answers.ahead ?? "" };
}

function isEmptyValue(value: DraftValue): boolean {
  return typeof value === "string" ? value.trim() === "" : Object.values(value).every((v) => v.trim() === "");
}

function valuesEqual(a: DraftValue, b: DraftValue | undefined): boolean {
  if (b === undefined) return false;
  if (typeof a === "string") return a === b;
  const bo = b as Record<string, string>;
  const ak = Object.keys(a);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => a[k] === bo[k]);
}

/**
 * The four panes, one at a time: the payload the server assembled, the step in view, and a
 * draft per step that a save in flight never overwrites. Nothing is saved on a keystroke —
 * only on leaving the step that holds it, leaving the page, or closing the tab — and a step's
 * own save requests run one at a time, in order, each reading the draft as it stands the moment
 * it actually runs rather than the moment it was queued, so a second save started while the
 * first is still in flight cannot land an older answer over a newer one.
 */
export function ReviewPage({ initial }: { initial: ReviewDTO }) {
  const router = useRouter();
  const [payload, setPayload] = useState(initial);
  const [step, setStep] = useState<ReviewStep>(initial.step);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(initial.answers));
  const [errors, setErrors] = useState<Partial<Record<ReviewStep, string>>>({});
  const [carried, setCarried] = useState<Set<number>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // What the server last confirmed for each step — the baseline a save-on-leave compares the
  // draft against, so leaving a step nothing was typed into (or leaving it exactly as it was
  // read) sends no request and answers nothing.
  const savedRef = useRef<ReviewAnswersDTO>({ ...initial.answers });

  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const chains = useRef<Record<ReviewStep, Promise<boolean>>>({
    clear: Promise.resolve(true),
    back: Promise.resolve(true),
    goals: Promise.resolve(true),
    ahead: Promise.resolve(true),
  });

  /** Saves `target` if its draft actually differs from what the server last confirmed, and does
   * nothing — no request, no answered mark — for a step nobody touched. Resolves `true` when
   * there was nothing to send or the send succeeded, `false` when it was attempted and failed
   * (the caller decides what a failure should stop). `keepalive` lets the request outlive a tab
   * that is closing (`beforeunload`) or a route that is unmounting. */
  function saveStep(target: ReviewStep, keepalive = false): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const value = draftsRef.current[target];
      const saved = savedRef.current[target];
      const dirty = saved === undefined ? !isEmptyValue(value) : !valuesEqual(value, saved);
      if (!dirty) return true;
      try {
        const res = await fetch("/api/review", {
          method: "PATCH",
          headers: JSON_HEADERS,
          keepalive,
          body: JSON.stringify({ week: payload.week, step: target, value }),
        });
        if (!res.ok) {
          setErrors((e) => ({ ...e, [target]: SAVE_ERROR }));
          return false;
        }
        savedRef.current = { ...savedRef.current, [target]: value };
        setErrors((e) => {
          if (!(target in e)) return e;
          const rest = { ...e };
          delete rest[target];
          return rest;
        });
        setPayload((await res.json()) as ReviewDTO);
        return true;
      } catch {
        setErrors((e) => ({ ...e, [target]: SAVE_ERROR }));
        return false;
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

  /** Every step whose draft has not yet made it to the server, attempted in parallel — one
   * step's failure does not hold up another's, and each still goes through its own per-step
   * queue, so this can never race a save already in flight for the same step. */
  function saveAllDirty(keepalive: boolean) {
    for (const s of REVIEW_STEPS) void saveStep(s, keepalive);
  }

  // The page going, by any route: unmounting (a dock link, the browser's own back button — any
  // client-side navigation away from /review) saves every step that still has an unsaved draft,
  // not only whichever one happened to be open — a step that failed earlier and was left behind
  // gets exactly the same chance to land as the one on screen when the page goes.
  useEffect(() => {
    return () => saveAllDirty(true);
    // Registered once: `saveStep` reads refs for whatever is current when this actually runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing the tab or reloading it does not unmount React at all — only `beforeunload` sees
  // that coming, and only a `keepalive` request can survive past it.
  useEffect(() => {
    function onBeforeUnload() {
      saveAllDirty(true);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The step just changed — for a keyboard or screen-reader user, focus follows it: not to the
  // Next/Back button, which may itself be about to go `disabled`, but to a landmark naming
  // where the review now stands. Compared against the previous step actually seen (written
  // inside this same effect), not against "is this the first run": a ref survives React
  // StrictMode's dev-only double-invoke of a fresh effect, so guarding on "have I run before"
  // still fires on that synthetic second run and steals focus on first paint. Comparing step
  // values instead only ever fires on a real change.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prevStepRef = useRef<ReviewStep | null>(null);
  useEffect(() => {
    if (prevStepRef.current !== null && prevStepRef.current !== step) headingRef.current?.focus();
    prevStepRef.current = step;
  }, [step]);

  /** Everything that mutates a task or the plan from here reloads the whole payload, rather
   * than guess which figure it moved — the same rule `PlanPane`'s own refresh follows. */
  async function refresh() {
    const res = await fetch(`/api/review?week=${payload.week}`).catch(() => null);
    if (res?.ok) setPayload((await res.json()) as ReviewDTO);
  }

  async function carry(taskId: number) {
    const res = await fetch("/api/plan", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ date: payload.ahead.week, taskId }) }).catch(() => null);
    if (!res?.ok) {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Could not carry that task." } }));
      return;
    }
    setCarried((s) => new Set(s).add(taskId));
    window.dispatchEvent(new Event("sb:plan-changed"));
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Carried to next Monday." } }));
    await refresh();
  }

  async function drop(taskId: number) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: "dropped" }) }).catch(() => null);
    if (!res?.ok) {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Could not drop that task." } }));
      return;
    }
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

  /** The deliberate end of the pass: saves the last step (the one Next never reaches), and only
   * leaves for Home once that has actually landed — a failed save keeps the person here, with
   * the answer still on screen and the error saying so, rather than losing it on the way out. */
  async function finish() {
    setFinishing(true);
    const ok = await saveStep("ahead");
    setFinishing(false);
    if (!ok) return;
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Review saved." } }));
    router.push("/");
  }

  const idx = REVIEW_STEPS.indexOf(step);
  const isLast = idx === REVIEW_STEPS.length - 1;
  const unsaved = new Set(Object.keys(errors) as ReviewStep[]);

  return (
    <div className="w-full max-w-3xl mx-auto px-6 lg:px-8 pt-8 pb-16 flex flex-col gap-5">
      <PageHeader title={payload.label} meta={payload.savedAt ? `Saved ${relativeTime(payload.savedAt)}` : "Not saved yet"} />

      <StepNav current={step} answers={payload.answers} unsaved={unsaved} onSelect={goTo} />

      {/* Named and focused on every step change — the focus move is the announcement; no
        * `aria-live` alongside it, which would have most assistive tech announce the change
        * twice (the live-region update and the focused element, independently). Invisible
        * otherwise — the visible position is `StepNav`'s highlighted button. */}
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {STEP_LABELS[step]} step
      </h2>

      {errors[step] && (
        <p role="alert" className="text-[12px] text-danger">
          {errors[step]}
        </p>
      )}

      <div className="min-w-0">
        {step === "clear" && (
          <StepClear
            inbox={payload.clear.inbox}
            leftover={payload.clear.leftover}
            carried={carried}
            value={drafts.clear}
            onChange={(value) => setDrafts((d) => ({ ...d, clear: value }))}
            onCarry={carry}
            onDrop={drop}
          />
        )}
        {step === "back" && <StepBack back={payload.back} value={drafts.back} onChange={(value) => setDrafts((d) => ({ ...d, back: value }))} />}
        {step === "goals" && (
          <StepGoals
            goals={payload.goals}
            asOf={payload.asOf}
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
        {isLast ? (
          <Button variant="primary" size="sm" disabled={finishing} onClick={() => void finish()}>
            Finish
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => goTo(REVIEW_STEPS[idx + 1])}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
