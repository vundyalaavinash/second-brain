"use client";

import { useState } from "react";
import { Check, CircleHelp, Dices, Ruler, Trash2, Undo2, X } from "lucide-react";
import type { PredictionDTO } from "@/lib/dto";
import { Button, IconButton, Input, Row } from "../ui";
import { inRange, resolvedAs, statedAs } from "./format";

const KIND_ICON = { estimate: Ruler, risk: Dices, call: CircleHelp } as const;
const KIND_LABEL = { estimate: "Estimate", risk: "Risk call", call: "Call" } as const;

function toast(text: string) {
  window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text } }));
}

/**
 * One logged call.
 *
 * An open row carries the way to score it and nothing else — the whole log is waiting on that
 * one action, so it is a button in the row rather than something behind a menu. A resolved row
 * carries what happened and the way to take it back, because the commonest mistake is scoring
 * the wrong row.
 */
export function LogRow({ prediction: p, today, onChanged }: { prediction: PredictionDTO; today: string; onChanged: () => void }) {
  const Icon = KIND_ICON[p.kind];
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);
  const open = p.resolvedAt === null;
  const overdue = open && p.resolveBy <= today;
  const hit = inRange(p);

  async function send(body: Record<string, unknown>, said: string) {
    setBusy(true);
    const res = await fetch(`/api/predictions/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const message = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      toast(message ?? "Could not save that");
      return;
    }
    toast(said);
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/predictions/${p.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast("Could not delete that");
      return;
    }
    toast("Deleted");
    onChanged();
  }

  return (
    <Row className="flex-wrap gap-y-1.5">
      {/* The kind, as a glyph with the word behind it: a screen reader hears "Risk call", and
        * the icon keeps the row narrow enough to survive beside the scoring control. */}
      <span className="shrink-0 flex items-center" title={KIND_LABEL[p.kind]}>
        <Icon className="w-3.5 h-3.5 text-fg-faint" aria-hidden />
        <span className="sr-only">{KIND_LABEL[p.kind]}</span>
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[13px] truncate">{p.claim}</span>
        <span className="text-[11.5px] text-fg-faint">
          {statedAs(p)}
          {statedAs(p) && " · "}
          {open ? `by ${p.resolveBy}` : resolvedAs(p)}
          {p.notes && ` · ${p.notes}`}
        </span>
      </span>

      {/* A missed range is worth seeing at a glance; a hit is not worth a badge. */}
      {hit === false && <span className="shrink-0 text-[11.5px] text-warn">outside 90%</span>}
      {overdue && <span className="shrink-0 text-[11.5px] text-danger">due</span>}

      {open ? (
        p.kind === "estimate" ? (
          <form
            className="shrink-0 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(actual);
              if (!Number.isFinite(value) || value < 0) {
                toast("What it actually took, as a number");
                return;
              }
              void send({ actual: value }, "Scored");
            }}
          >
            <Input
              size="sm"
              type="number"
              step="any"
              min="0"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              aria-label={`What ${p.claim} actually took, in ${p.unit ?? "the same unit"}`}
              placeholder={p.unit ?? "actual"}
              className="w-24"
            />
            <Button size="sm" type="submit" disabled={busy || actual === ""}>
              Score
            </Button>
          </form>
        ) : (
          <span className="shrink-0 flex items-center gap-0.5">
            <IconButton
              label={p.kind === "risk" ? `It happened: ${p.claim}` : `Right: ${p.claim}`}
              icon={Check}
              disabled={busy}
              onClick={() => void send({ outcome: true }, "Scored")}
            />
            <IconButton
              label={p.kind === "risk" ? `It did not happen: ${p.claim}` : `Wrong: ${p.claim}`}
              icon={X}
              disabled={busy}
              onClick={() => void send({ outcome: false }, "Scored")}
            />
          </span>
        )
      ) : (
        <IconButton label={`Put ${p.claim} back to open`} icon={Undo2} disabled={busy} onClick={() => void send({ unresolve: true }, "Back to open")} />
      )}

      <IconButton label={`Delete ${p.claim}`} icon={Trash2} danger disabled={busy} onClick={() => void remove()} />
    </Row>
  );
}
