"use client";

import { useCallback, useRef, useState } from "react";
import { AlarmClock, Plus, Ruler } from "lucide-react";
import { PREDICTION_KINDS, type PredictionKind } from "@/db/enums";
import type { PredictionsDTO } from "@/lib/dto";
import { Button, Chip, EmptyState, List, PageHeader, SectionHeading } from "../ui";
import { LogForm } from "./log-form";
import { LogRow } from "./log-row";
import { ScoreStrip } from "./score-strip";

type State = "open" | "resolved" | "all";

const KIND_LABEL: Record<PredictionKind, string> = { estimate: "Estimates", risk: "Risk calls", call: "Calls" };
const STATE_LABEL: Record<State, string> = { open: "Open", resolved: "Scored", all: "All" };

/**
 * The log: every call made, what it was called as, and what it turned out to be.
 *
 * The overdue section sits above the list rather than inside it. Scoring a call is the one action
 * the whole log depends on, and an overdue row buried in reverse-chronological order among a
 * hundred others is a row nobody scores.
 */
export function LogPage({ initial }: { initial: PredictionsDTO }) {
  const [data, setData] = useState(initial);
  const [kind, setKind] = useState<PredictionKind | null>(null);
  const [state, setState] = useState<State>("open");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async (nextKind: PredictionKind | null, nextState: State) => {
    const id = ++request.current;
    const params = new URLSearchParams();
    if (nextKind) params.set("kind", nextKind);
    params.set("state", nextState);
    const res = await fetch(`/api/predictions?${params}`).catch(() => null);
    const body = res?.ok ? ((await res.json()) as PredictionsDTO) : null;
    // Only the latest request speaks: an earlier one landing late must not paint a stale list
    // or a stale error over a newer one.
    if (id !== request.current) return;
    if (!body) {
      setError("Could not refresh the log. Showing what was last loaded.");
      return;
    }
    setError(null);
    setData(body);
  }, []);

  const refresh = useCallback(() => void load(kind, state), [load, kind, state]);

  function pickKind(next: PredictionKind | null) {
    setKind(next);
    void load(next, state);
  }

  function pickState(next: State) {
    setState(next);
    void load(kind, next);
  }

  const { scores, due, predictions, today } = data;
  const logged = scores.estimate.logged + scores.risk.logged + scores.call.logged;
  // The overdue set is drawn from the whole log rather than from the filter, so under "Open" its
  // rows would otherwise appear twice on one screen -- once above and once below.
  const overdue = new Set(due.map((p) => p.id));
  const rest = predictions.filter((p) => !overdue.has(p.id));

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Log"
        meta={<ScoreStrip scores={scores} />}
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding((a) => !a)}>
            Log a call
          </Button>
        }
      />

      {adding && <LogForm today={today} onSaved={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {error && <p className="text-[12px] text-fg-faint m-0">{error}</p>}

      {due.length > 0 && (
        <section>
          <SectionHeading count={due.length}>Waiting to be scored</SectionHeading>
          <p className="text-[12px] text-fg-faint mt-0 mb-1.5">The answer is already knowable. Until these are scored the figures above describe only the calls that were fun to come back to.</p>
          <List>
            {due.map((p) => (
              <LogRow key={p.id} prediction={p} today={today} onChanged={refresh} />
            ))}
          </List>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={kind === null} onClick={() => pickKind(null)}>
            Everything
          </Chip>
          {PREDICTION_KINDS.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => pickKind(k)}>
              {KIND_LABEL[k]}
            </Chip>
          ))}
          <span className="w-px h-4 bg-hairline mx-1" aria-hidden />
          {(["open", "resolved", "all"] as State[]).map((s) => (
            <Chip key={s} active={state === s} onClick={() => pickState(s)}>
              {STATE_LABEL[s]}
            </Chip>
          ))}
        </div>

        {rest.length === 0 ? (
          logged === 0 ? (
            <EmptyState
              icon={Ruler}
              text="Nothing logged yet. Write the range or the probability down before you say it out loud — that is the whole trick."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Log a call
                </Button>
              }
            />
          ) : (
            <EmptyState icon={AlarmClock} text={due.length > 0 ? "Everything under this filter is waiting to be scored, above." : "Nothing here under this filter."} />
          )
        ) : (
          <List>
            {rest.map((p) => (
              <LogRow key={p.id} prediction={p} today={today} onChanged={refresh} />
            ))}
          </List>
        )}
      </section>
    </div>
  );
}
