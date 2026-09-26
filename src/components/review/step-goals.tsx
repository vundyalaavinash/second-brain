"use client";

import { Fragment } from "react";
import { Target } from "lucide-react";
import type { GoalDTO } from "@/lib/dto";
import { GoalRow } from "../goals/goal-row";
import { Button, EmptyState, Input, SectionHeading } from "../ui";

/**
 * Third step: each active goal, `GoalRow` and all — the same row Goals itself shows, stalled
 * wording included, so nothing here has to repeat what that row already says — with a one-line
 * box beneath it for the week's note. `value` is keyed by goal id (as a string: object keys
 * always are), one note per goal, never one prose block for all of them at once.
 *
 * `asOf` is the day `goals[].measure` was actually measured against (the reviewed week's own
 * last day for a closed week, today for the current one) — never plain "today", which would
 * read a past week's frozen `stalled`/`movement` figures beside a days-left count taken from a
 * different day than the one they were computed for.
 */
export function StepGoals({ goals, asOf, value, onChange }: { goals: GoalDTO[]; asOf: string; value: Record<string, string>; onChange: (goalId: string, note: string) => void }) {
  return (
    <section>
      <SectionHeading count={goals.length}>Goals</SectionHeading>
      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          text="No active goals to check in on."
          action={
            <Button href="/goals" variant="secondary" size="sm">
              Set a goal
            </Button>
          }
        />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {goals.map((g) => {
            const id = String(g.id);
            return (
              <Fragment key={g.id}>
                <GoalRow goal={g} today={asOf} />
                <li className="hairline-row px-1 pb-3">
                  <Input
                    aria-label={`Note for ${g.title}`}
                    size="sm"
                    value={value[id] ?? ""}
                    onChange={(e) => onChange(id, e.target.value)}
                    placeholder="A line on how it's going"
                  />
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}
