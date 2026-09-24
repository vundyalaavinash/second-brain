"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleCheck, CircleX, CircleSlash } from "lucide-react";
import type { GoalDTO } from "@/lib/dto";
import type { GoalStatus } from "@/db/enums";
import { Button } from "../ui";

interface Props {
  goal: GoalDTO;
  onDone: (goal: GoalDTO) => void;
  onClose: () => void;
}

/**
 * Asks how a goal landed and closes it that way. The three choices and the error banner mirror
 * complete-project-dialog.tsx's shape; the modal semantics (role, Escape, focus-in) do not — see
 * task-2-review.md finding 3: that dialog is the repo's outlier, not its norm.
 */
export function CloseGoalDialog({ goal, onDone, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${useId()}-close-goal-title`;

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function close(status: Exclude<GoalStatus, "active">) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      onDone((await res.json()) as GoalDTO);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel w-[480px] max-w-[92vw] rounded-lg p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[16px] font-medium">
          Close “{goal.title}”
        </h2>
        <p className="text-[13px] text-fg-muted">How did it land?</p>
        <Button variant="secondary" icon={CircleCheck} disabled={busy} onClick={() => void close("hit")} className="w-full justify-start h-9">
          Hit — it happened
        </Button>
        <Button variant="secondary" icon={CircleX} disabled={busy} onClick={() => void close("missed")} className="w-full justify-start h-9">
          Missed — the date passed without it
        </Button>
        <Button variant="secondary" icon={CircleSlash} disabled={busy} onClick={() => void close("dropped")} className="w-full justify-start h-9">
          Dropped — no longer the goal
        </Button>
        {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <Button variant="ghost" size="sm" onClick={onClose} className="self-end">
          Cancel
        </Button>
      </div>
    </div>
  );
}
