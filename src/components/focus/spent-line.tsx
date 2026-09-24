"use client";

import { useState } from "react";
import { formatDuration } from "../activity/format";
import { Button } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };

/** Close enough that correcting the estimate would only be noise. */
const AGREEMENT_MINUTES = 5;

/** `PatchTaskBody.estimateMinutes` in `src/lib/validation.ts`, a server module this client
 * component cannot import — the constant is small and stable enough to duplicate rather than
 * couple a task row to the domain's db-backed modules. Never used to clamp what is offered: a
 * spent figure outside this range is still shown honestly, only the correction button is
 * withheld, since silently offering 480 for 500 spent minutes would be quietly wrong (F2). */
const MIN_OFFERABLE_ESTIMATE = 5;
const MAX_OFFERABLE_ESTIMATE = 480;

interface Props {
  taskId: number;
  estimateMinutes: number | null;
  spentMinutes: number;
}

/**
 * What a task actually cost, read back once a run has landed against it — the answer to the
 * question the app used to only ask. Nothing renders until a run has landed: a task untouched
 * by a focus run gets no "0m" and no empty line for it. Where the guess and the real figure
 * disagree by more than a few minutes (or there was no guess at all), this is also where the
 * estimate gets corrected from the real one, so the next task of the same shape is guessed
 * better.
 */
export function SpentLine({ taskId, estimateMinutes, spentMinutes }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (spentMinutes <= 0) return null;

  const spent = formatDuration(spentMinutes * 60_000);
  const line =
    estimateMinutes !== null ? `Estimated ${formatDuration(estimateMinutes * 60_000)}, spent ${spent}` : `Spent ${spent}`;
  const disagrees = estimateMinutes === null || Math.abs(estimateMinutes - spentMinutes) > AGREEMENT_MINUTES;
  // The spent figure is shown either way — it is what actually happened. The offer to correct
  // the estimate from it is withheld outside the API's own bounds rather than clamped into them:
  // clamping would offer a number that was never the real one (F2).
  const offerable = spentMinutes >= MIN_OFFERABLE_ESTIMATE && spentMinutes <= MAX_OFFERABLE_ESTIMATE;
  const offCourse = disagrees && offerable;

  function useAsEstimate() {
    setBusy(true);
    setError(null);
    void (async () => {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ estimateMinutes: spentMinutes }),
      });
      setBusy(false);
      if (!res.ok) {
        setError("Could not update the estimate");
        return;
      }
      window.dispatchEvent(new Event("sb:tasks-changed"));
    })();
  }

  return (
    <span className="flex items-center gap-2 flex-wrap text-[11.5px] text-fg-faint">
      <span>{line}</span>
      {offCourse && (
        <Button variant="ghost" size="sm" onClick={useAsEstimate} disabled={busy} className="h-5 px-1.5 text-[11px]">
          Use {spent} as the estimate
        </Button>
      )}
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}
