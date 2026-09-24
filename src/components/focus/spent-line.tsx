"use client";

import { useState } from "react";
import { formatDuration } from "../activity/format";
import { Button } from "../ui";

const JSON_HEADERS = { "content-type": "application/json" };

/** Close enough that correcting the estimate would only be noise. */
const AGREEMENT_MINUTES = 5;

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
  const offCourse = estimateMinutes === null || Math.abs(estimateMinutes - spentMinutes) > AGREEMENT_MINUTES;

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
