import { Check } from "lucide-react";
import { REVIEW_STEPS, type ReviewStep } from "@/db/enums";
import type { ReviewAnswersDTO } from "@/lib/dto";

/** Shared with `ReviewPage`, whose pane headings and free-text prompts read the same words. */
export const STEP_LABELS: Record<ReviewStep, string> = {
  clear: "Clear the decks",
  back: "Look back",
  goals: "Goals",
  ahead: "Look ahead",
};

/** A step counts as answered once its own key is in `answers` — set the moment a save for it
 * has gone through, however short what it holds. */
function isAnswered(step: ReviewStep, answers: ReviewAnswersDTO): boolean {
  return answers[step] !== undefined;
}

/** The four steps across the top: a landmark of its own, so the keyboard can jump straight to
 * it, the open step named as the page's current position rather than merely "selected", and a
 * step already answered marked so without waiting for its own pane to say so again. */
export function StepNav({ current, answers, onSelect }: { current: ReviewStep; answers: ReviewAnswersDTO; onSelect: (step: ReviewStep) => void }) {
  return (
    // Two columns until there is room for a single row of four — "Clear the decks" needs more
    // than a quarter of 400px to sit on one line — so a phone gets a 2x2 grid rather than
    // wrapped, clipped text inside a fixed-height button.
    <nav aria-label="Review steps" className="grid grid-cols-2 min-[560px]:flex items-center gap-1 pane p-1">
      {REVIEW_STEPS.map((step) => {
        const active = step === current;
        const done = isAnswered(step, answers);
        return (
          <button
            key={step}
            type="button"
            aria-current={active ? "step" : undefined}
            onClick={() => onSelect(step)}
            className={`focus-ring min-[560px]:flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-2 rounded-sm text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 ${
              active ? "bg-violet text-on-violet" : "text-fg-muted hover:text-fg hover:bg-layer-2"
            }`}
          >
            {done && !active && <Check className="w-3 h-3 text-fg-faint" aria-hidden />}
            {STEP_LABELS[step]}
            {/* The tick is decoration; this is the mark — in the accessible name itself, not
              * only in a shape a screen reader has no reason to describe. */}
            {done && !active && <span className="sr-only">, answered</span>}
          </button>
        );
      })}
    </nav>
  );
}
