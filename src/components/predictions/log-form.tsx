"use client";

import { useState } from "react";
import { PREDICTION_KINDS, PREDICTION_UNITS, type PredictionKind, type PredictionUnit } from "@/db/enums";
import { Button, Input, Select } from "../ui";

const KIND_LABEL: Record<PredictionKind, string> = { estimate: "Estimate", risk: "Risk call", call: "Call" };

/** What each kind is for, said once, where someone is about to pick one. */
const KIND_HINT: Record<PredictionKind, string> = {
  estimate: "Two ranges and, later, what it actually took.",
  risk: "A probability it happens, and later whether it did.",
  call: "A claim, scored right or wrong.",
};

const FIELD_LABEL = "text-[12px] text-fg-muted";

/**
 * Logging a call, before you say the number out loud.
 *
 * The fields change with the kind because the kinds genuinely hold different things — one form
 * of optional everything would let an estimate be saved with no ranges, which is a row that can
 * never be scored. The 90% bounds default to the 50% ones so the commonest mistake (a 90% range
 * narrower than the 50%, which the server refuses) starts from something valid.
 */
export function LogForm({ today, onSaved, onCancel }: { today: string; onSaved: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<PredictionKind>("estimate");
  const [claim, setClaim] = useState("");
  const [resolveBy, setResolveBy] = useState(today);
  const [unit, setUnit] = useState<PredictionUnit>("days");
  const [p50Low, setP50Low] = useState("");
  const [p50High, setP50High] = useState("");
  const [p90Low, setP90Low] = useState("");
  const [p90High, setP90High] = useState("");
  const [probability, setProbability] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const base = { claim, resolveBy, notes: notes.trim() || undefined };
    let body: Record<string, unknown>;
    if (kind === "estimate") {
      const nums = [p50Low, p50High, p90Low || p50Low, p90High || p50High].map(Number);
      if (nums.some((n) => !Number.isFinite(n))) {
        setError("All four bounds have to be numbers.");
        return;
      }
      body = { kind, ...base, unit, p50Low: nums[0], p50High: nums[1], p90Low: nums[2], p90High: nums[3] };
    } else if (kind === "risk") {
      // Typed as a percentage, because that is how a risk gets said out loud.
      const percent = Number(probability);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        setError("A probability is 0 to 100.");
        return;
      }
      body = { kind, ...base, probability: percent / 100 };
    } else {
      body = { kind, ...base };
    }

    setBusy(true);
    const res = await fetch("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const message = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(message ?? "Could not log that.");
      return;
    }
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Logged" } }));
    onSaved();
  }

  return (
    <form
      className="pane p-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Kind</span>
          <Select size="sm" value={kind} onChange={(e) => setKind(e.target.value as PredictionKind)} className="w-36">
            {PREDICTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex-1 min-w-[16rem] flex flex-col gap-1">
          <span className={FIELD_LABEL}>Claim</span>
          <Input
            size="sm"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder={kind === "risk" ? "Reconciliation has a production bug by launch + 30 days" : "Ledger migration"}
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Resolves by</span>
          <Input size="sm" type="date" value={resolveBy} onChange={(e) => setResolveBy(e.target.value)} required className="w-40" />
        </label>
      </div>

      <p className="text-[11.5px] text-fg-faint m-0">{KIND_HINT[kind]}</p>

      {kind === "estimate" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Unit</span>
            <Select size="sm" value={unit} onChange={(e) => setUnit(e.target.value as PredictionUnit)} className="w-28">
              {PREDICTION_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </label>
          <Bound label="50% low" value={p50Low} onChange={setP50Low} required />
          <Bound label="50% high" value={p50High} onChange={setP50High} required />
          <Bound label="90% low" value={p90Low} onChange={setP90Low} placeholder={p50Low} />
          <Bound label="90% high" value={p90High} onChange={setP90High} placeholder={p50High} />
        </div>
      )}

      {kind === "risk" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Chance it happens (%)</span>
            <Input size="sm" type="number" min="0" max="100" step="any" value={probability} onChange={(e) => setProbability(e.target.value)} required className="w-28" />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>Notes</span>
        <Input size="sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference class, or what would prove this wrong" />
      </label>

      {error && <p className="text-[12px] text-danger m-0">{error}</p>}

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={busy}>
          Log it
        </Button>
        <Button size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Bound({
  label,
  value,
  onChange,
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      <Input
        size="sm"
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-24"
      />
    </label>
  );
}
