"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import type { PlanTaskDTO } from "@/lib/dto";
import { formatShortDate } from "../tasks/task-row";
import { Button, EmptyState, List, Row, SectionHeading, Textarea } from "../ui";
import { InboxProcessor } from "../inbox-processor";

interface Props {
  leftover: PlanTaskDTO[];
  value: string;
  onChange: (value: string) => void;
  /** Moves the task onto next Monday's plan; it stays wherever else it already sits. */
  onCarry: (taskId: number) => void;
  /** Drops the task outright. */
  onDrop: (taskId: number) => void;
}

/**
 * First step: the inbox, and whatever the week planned but never got to. `InboxProcessor` is
 * the same widget `/inbox` renders — its own fetch, its own keyboard, nothing rebuilt here — so
 * a person who has already learned that screen needs nothing new to clear this one.
 */
export function StepClear({ leftover, value, onChange, onCarry, onDrop }: Props) {
  // Purely local, purely a mark that a row has been looked at and left as it stands: nothing
  // here is written anywhere, so it does not survive leaving the step and back is fine.
  const [left, setLeft] = useState<Set<number>>(new Set());

  return (
    <div className="flex flex-col gap-6">
      <InboxProcessor />

      <section>
        <SectionHeading count={leftover.length}>Left over from this week</SectionHeading>
        {leftover.length === 0 ? (
          <EmptyState icon={ListChecks} text="Nothing was left open this week." />
        ) : (
          <List>
            {leftover.map((t) => {
              const done = left.has(t.id);
              return (
                <Row key={t.id} className={done ? "opacity-50" : ""}>
                  <span className="flex-1 min-w-0 truncate text-[13px]">{t.title}</span>
                  {t.dueDate && <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatShortDate(t.dueDate)}</span>}
                  <Button size="sm" variant="secondary" onClick={() => onCarry(t.id)}>
                    Carry
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDrop(t.id)}>
                    Drop
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={done}
                    onClick={() =>
                      setLeft((s) => {
                        const next = new Set(s);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      })
                    }
                  >
                    {done ? "Left" : "Leave"}
                  </Button>
                </Row>
              );
            })}
          </List>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <label htmlFor="review-clear-notes" className="text-[12.5px] text-fg-muted">
          Anything to flag before moving on
        </label>
        <Textarea id="review-clear-notes" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Notes on clearing the decks" />
      </section>
    </div>
  );
}
