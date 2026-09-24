"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target } from "lucide-react";
import type { GoalDTO } from "@/lib/dto";
import { Button, EmptyState, PageHeader } from "../ui";
import { GoalRow } from "./goal-row";
import { GoalForm } from "./goal-form";

/** One interaction (closing a goal, relinking a container) often fires more than one change
 * in the same breath; the events are let to settle into one request, as Home does it. */
const REFRESH_MS = 50;

export function GoalList({ active: initialActive, closed: initialClosed, today }: { active: GoalDTO[]; closed: GoalDTO[]; today: string }) {
  const router = useRouter();
  const [active, setActive] = useState(initialActive);
  const [closed, setClosed] = useState(initialClosed);
  const [creating, setCreating] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const newGoalButtonRef = useRef<HTMLButtonElement>(null);

  // A refresh still waiting when the page goes belongs to nothing.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const id = ++request.current;
      void (async () => {
        // One list carries everything, already sorted active-first: the split into the two
        // sections happens here rather than as two requests.
        const res = await fetch("/api/goals").catch(() => null);
        const body = res?.ok ? ((await res.json()) as { goals: GoalDTO[] }) : null;
        // Only the latest request gets to speak, on either a success or a failure: an earlier
        // one that failed after a later one already landed must not paint a stale error over it.
        if (id !== request.current) return;
        if (!body) {
          setRefreshError("Could not refresh the list. Showing what was last loaded.");
          return;
        }
        setRefreshError(null);
        setActive(body.goals.filter((g) => g.status === "active"));
        setClosed(body.goals.filter((g) => g.status !== "active"));
      })();
    }, REFRESH_MS);
  }, []);

  useEffect(() => {
    window.addEventListener("sb:goals-changed", refresh);
    return () => window.removeEventListener("sb:goals-changed", refresh);
  }, [refresh]);

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Goals"
        meta={
          <>
            <span className="font-mono">{active.length}</span> active, <span className="font-mono">{closed.length}</span> closed
          </>
        }
        actions={
          <Button ref={newGoalButtonRef} variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New goal
          </Button>
        }
      />
      {refreshError && <p className="text-[12px] text-fg-faint">{refreshError}</p>}
      {active.length === 0 ? (
        <EmptyState icon={Target} text="No active goals yet. A goal is an outcome above your projects, with a date." />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {active.map((g) => (
            <GoalRow key={g.id} goal={g} today={today} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="pane p-2">
          <summary className="micro px-1 cursor-pointer focus-ring rounded-sm">Closed ({closed.length})</summary>
          <ul className="list-none m-0 p-0 pt-2 flex flex-col">
            {closed.map((g) => (
              <GoalRow key={g.id} goal={g} today={today} />
            ))}
          </ul>
        </details>
      )}
      {creating && (
        <GoalForm
          onClose={() => {
            setCreating(false);
            newGoalButtonRef.current?.focus();
          }}
          onSaved={(g) => {
            setCreating(false);
            window.dispatchEvent(new Event("sb:goals-changed"));
            router.push(`/goals/${g.id}`);
          }}
        />
      )}
    </div>
  );
}
