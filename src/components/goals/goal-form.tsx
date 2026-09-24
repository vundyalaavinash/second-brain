"use client";

import { useId, useState } from "react";
import type { GoalDTO } from "@/lib/dto";
import type { GoalHorizon } from "@/db/enums";
import { GOAL_HORIZONS } from "@/db/enums";
import { titleCase } from "@/lib/format";
import { Button, Chip, Input, Textarea } from "../ui";

interface Props {
  /** Absent for a new goal; present to edit one in place. */
  goal?: GoalDTO;
  onSaved: (goal: GoalDTO) => void;
  onClose: () => void;
}

/** Creates and edits a goal: title, outcome, horizon, target date, notes. */
export function GoalForm({ goal, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [outcome, setOutcome] = useState(goal?.outcome ?? "");
  const [horizon, setHorizon] = useState<GoalHorizon>(goal?.horizon ?? "quarter");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [notes, setNotes] = useState(goal?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `${useId()}-goal-title`;
  const outcomeId = `${useId()}-goal-outcome`;
  const dateId = `${useId()}-goal-date`;
  const notesId = `${useId()}-goal-notes`;

  const canSave = title.trim().length > 0 && targetDate.length > 0 && !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const body = { title: title.trim(), outcome: outcome.trim(), horizon, targetDate, notes };
      const res = await fetch(goal ? `/api/goals/${goal.id}` : "/api/goals", {
        method: goal ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      onSaved((await res.json()) as GoalDTO);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="panel w-[480px] max-w-[92vw] rounded-lg p-5 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-medium">{goal ? "Edit goal" : "New goal"}</h2>
        <label className="flex flex-col gap-1" htmlFor={titleId}>
          <span className="text-[11.5px] text-fg-muted">Title</span>
          <Input id={titleId} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this goal called?" />
        </label>
        <label className="flex flex-col gap-1" htmlFor={outcomeId}>
          <span className="text-[11.5px] text-fg-muted">Outcome</span>
          <Input id={outcomeId} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What does done look like?" />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] text-fg-muted">Horizon</span>
          <div role="radiogroup" aria-label="Horizon" className="flex items-center gap-2">
            {GOAL_HORIZONS.map((h) => (
              <Chip key={h} role="radio" aria-checked={horizon === h} active={horizon === h} onClick={() => setHorizon(h)}>
                {titleCase(h)}
              </Chip>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1" htmlFor={dateId}>
          <span className="text-[11.5px] text-fg-muted">Target date</span>
          <Input id={dateId} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-40" />
        </label>
        <label className="flex flex-col gap-1" htmlFor={notesId}>
          <span className="text-[11.5px] text-fg-muted">Notes</span>
          <Textarea id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[72px]" />
        </label>
        {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2 mt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canSave} onClick={() => void submit()}>
            {goal ? "Save" : "Create goal"}
          </Button>
        </div>
      </div>
    </div>
  );
}
