import { AlertTriangle, Check } from "lucide-react";
import { REVIEW_STEP_LABELS, REVIEW_STEPS, type ReviewStep } from "@/db/enums";
import type { ReviewAnswersDTO } from "@/lib/dto";

/** Shared with `ReviewPage` (whose pane headings and free-text prompts read the same words) and
 * with the `##` headings `renderReviewBody` writes into the item's own Markdown — all three read
 * `REVIEW_STEP_LABELS`, the one place the four names are spelled out. */
export const STEP_LABELS = REVIEW_STEP_LABELS;

/** A step counts as answered once its own key is in `answers` — set the moment a save for it
 * has gone through, however short what it holds. */
function isAnswered(step: ReviewStep, answers: ReviewAnswersDTO): boolean {
  return answers[step] !== undefined;
}

/** The four steps across the top: a landmark of its own, so the keyboard can jump straight to
 * it, the open step named as the page's current position rather than merely "selected", a step
 * already answered marked so without waiting for its own pane to say so again — and a step
 * whose last save failed marked here too, so it stays visible from every other step rather than
 * only from the one pane a person has since left. */
export function StepNav({
  current,
  answers,
  unsaved,
  onSelect,
}: {
  current: ReviewStep;
  answers: ReviewAnswersDTO;
  /** Steps whose most recent save attempt failed and has not since succeeded. */
  unsaved: Set<ReviewStep>;
  onSelect: (step: ReviewStep) => void;
}) {
  return (
    // Two columns until there is room for a single row of four — "Clear the decks" needs more
    // than a quarter of 400px to sit on one line — so a phone gets a 2x2 grid rather than
    // wrapped, clipped text inside a fixed-height button.
    <nav aria-label="Review steps" className="grid grid-cols-2 min-[560px]:flex items-center gap-1 pane p-1">
      {REVIEW_STEPS.map((step) => {
        const active = step === current;
        const done = isAnswered(step, answers);
        const failed = unsaved.has(step);
        return (
          <button
            key={step}
            type="button"
            aria-current={active ? "step" : undefined}
            onClick={() => onSelect(step)}
            className={`focus-ring min-[560px]:flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-2 rounded-sm text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 ${
              active ? "bg-violet text-on-violet" : failed ? "text-danger hover:bg-danger/10" : "text-fg-muted hover:text-fg hover:bg-layer-2"
            }`}
          >
            {failed ? (
              <AlertTriangle className="w-3 h-3" aria-hidden />
            ) : (
              done && !active && <Check className="w-3 h-3 text-fg-faint" aria-hidden />
            )}
            {STEP_LABELS[step]}
            {/* The icon is decoration; these are the marks — in the accessible name itself, not
              * only in a shape a screen reader has no reason to describe. A step can be both
              * answered and failed (an edit since the last good save didn't land); failed wins,
              * since it is the one a person needs to act on. */}
            {failed ? <span className="sr-only">, not saved</span> : done && !active && <span className="sr-only">, answered</span>}
          </button>
        );
      })}
    </nav>
  );
}
