"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Check, RotateCcw, Trash2 } from "lucide-react";
import type { GoalDetailDTO, GoalDTO } from "@/lib/dto";
import { deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { formatDate, titleCase } from "@/lib/format";
import { Button, IconButton } from "../ui";
import { ProgressRing } from "../tasks/progress-ring";
import { Crumb } from "../shell/crumb";
import { goalMovementLabel } from "./goal-row";
import { GoalForm } from "./goal-form";
import { CloseGoalDialog } from "./close-goal-dialog";
import { DeleteGoalDialog } from "./delete-goal-dialog";
import { GoalLinksEditor } from "./goal-links-editor";

const STATUS_LABEL: Record<GoalDTO["status"], string> = { active: "Active", hit: "Hit", missed: "Missed", dropped: "Dropped" };

export function GoalPage({ initial, today }: { initial: GoalDetailDTO; today: string }) {
  const router = useRouter();
  const [goal, setGoal] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each dialog's trigger keeps its own ref, the way dock.tsx's `moreRef` does, so focus can be
  // handed back to the control that opened it once the dialog closes.
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  /** A patch carries the whole GoalDTO shape, so it can simply overwrite everything but the
   * two fields (`links`, `recentCloses`) the detail view alone knows about. */
  function applyPatch(patch: GoalDTO) {
    setGoal((g) => ({ ...g, ...patch }));
    window.dispatchEvent(new Event("sb:goals-changed"));
  }

  async function reopen() {
    if (reopening) return;
    setReopening(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
        return;
      }
      applyPatch((await res.json()) as GoalDTO);
    } finally {
      setReopening(false);
    }
  }

  const due = deadlineLabel(goal.targetDate, today);
  const m = goal.measure;

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-4">
      <Crumb title={goal.title} parent={{ label: "Goals", href: "/goals" }} />

      <header className="flex items-center gap-2 h-10 mb-1">
        <Link href="/goals" className="focus-ring inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg">
          <ArrowLeft className="w-3.5 h-3.5" />
          Goals
        </Link>
        <span className="text-[12.5px] text-fg-muted">{titleCase(goal.horizon)}</span>
        {goal.status !== "active" && (
          <span className="text-[11.5px] text-fg-muted">
            {STATUS_LABEL[goal.status]}
            {goal.closedAt ? `, ${formatDate(goal.closedAt)}` : ""}
          </span>
        )}
        <span className="flex-1" />
        <Button ref={editButtonRef} variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
          Edit
        </Button>
        {goal.status === "active" ? (
          <Button ref={closeButtonRef} variant="secondary" size="sm" icon={Check} onClick={() => setClosing(true)}>
            Close
          </Button>
        ) : (
          <Button variant="secondary" size="sm" icon={RotateCcw} disabled={reopening} onClick={() => void reopen()}>
            Reopen
          </Button>
        )}
        <IconButton ref={deleteButtonRef} label="Delete goal" icon={Trash2} onClick={() => setDeleting(true)} />
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <section className="pane p-6 flex flex-col gap-4">
        <h1 className="text-[22px] leading-7 font-medium tracking-[-0.01em]">{goal.title}</h1>
        {goal.outcome && <p className="text-[15px] text-fg-muted m-0">{goal.outcome}</p>}
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-3">
            <ProgressRing percent={m.percent} size={56} stroke={4} />
            <div className="text-[13px] text-fg-muted">
              <span className="font-mono text-fg">{m.done}</span> of <span className="font-mono text-fg">{m.total}</span> done
            </div>
          </div>
          <span className={`text-[13px] ${m.stalled ? "text-fg-faint" : "text-fg-muted"}`}>{goalMovementLabel(m, today)}</span>
          <span className={`text-[13px] ${TONE_CLASS[due.tone]}`}>{due.text}</span>
        </div>
        {goal.notes && <p className="text-[13.5px] text-fg-muted whitespace-pre-wrap m-0">{goal.notes}</p>}
      </section>

      <GoalLinksEditor goalId={goal.id} links={goal.links} onChange={setGoal} />

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-fg">Recently closed</h2>
        {goal.recentCloses.length === 0 ? (
          <p className="text-[13px] text-fg-faint">Nothing closed against this yet.</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col">
            {goal.recentCloses.map((t) => (
              <li key={t.id} className="hairline-row flex items-center gap-2.5 py-1.5 min-w-0">
                <span className="flex-1 min-w-0 truncate text-[13px]">{t.title}</span>
                <span className="text-[12px] text-fg-faint truncate max-w-[10rem]">{t.containerName}</span>
                <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatDate(t.completedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <GoalForm
          goal={goal}
          onClose={() => {
            setEditing(false);
            editButtonRef.current?.focus();
          }}
          onSaved={(g) => {
            setEditing(false);
            applyPatch(g);
            editButtonRef.current?.focus();
          }}
        />
      )}
      {closing && (
        <CloseGoalDialog
          goal={goal}
          onClose={() => {
            setClosing(false);
            closeButtonRef.current?.focus();
          }}
          onDone={(g) => {
            setClosing(false);
            applyPatch(g);
            closeButtonRef.current?.focus();
          }}
        />
      )}
      {deleting && (
        <DeleteGoalDialog
          goal={goal}
          onClose={() => {
            setDeleting(false);
            deleteButtonRef.current?.focus();
          }}
          onDeleted={() => {
            window.dispatchEvent(new Event("sb:goals-changed"));
            router.push("/goals");
          }}
        />
      )}
    </div>
  );
}
