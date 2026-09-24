"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { GoalDTO } from "@/lib/dto";
import { Button } from "../ui";

interface Props {
  goal: GoalDTO;
  onDeleted: () => void;
  onClose: () => void;
}

/**
 * Confirms the one irreversible action on this screen. A goal is never empty by construction
 * the way an archivable container is — it can carry notes, an outcome, a target date and a
 * whole link set — so this names what disappears instead of a second click on an icon whose
 * only change was its label (see task-2-review.md finding 1).
 */
export function DeleteGoalDialog({ goal, onDeleted, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${useId()}-delete-goal-title`;

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

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const linkCount = goal.containers.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel w-[440px] max-w-[92vw] rounded-lg p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[16px] font-medium">
          Delete “{goal.title}”?
        </h2>
        <p className="text-[13px] text-fg-muted">
          {linkCount === 0
            ? "This cannot be undone."
            : `This also clears its ${linkCount} link${linkCount === 1 ? "" : "s"} to projects and areas — they stay, only the goal and its links go. This cannot be undone.`}
        </p>
        {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 mt-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={() => void confirm()}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
