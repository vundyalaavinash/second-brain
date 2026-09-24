"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import type { ReviewDTO } from "@/lib/dto";
import { formatClock } from "../activity/format";
import { formatShortDate } from "../tasks/task-row";
import { localDay } from "@/lib/time";
import { Button, EmptyState, List, Row, SectionHeading, Textarea } from "../ui";

interface Props {
  ahead: ReviewDTO["ahead"];
  value: string;
  onChange: (value: string) => void;
  /** Plans the checked tasks onto next week's Monday, through `/api/review/plan`. */
  onPlan: (taskIds: number[]) => Promise<void>;
}

/**
 * Fourth step: what is already coming — due tasks, project deadlines, meetings already on the
 * calendar — plus the intention for the week and one button that plans whichever tasks were
 * checked. Deadlines and meetings are read here, not acted on: only a task can go on a plan.
 */
export function StepAhead({ ahead, value, onChange, onPlan }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [planning, setPlanning] = useState(false);
  const empty = ahead.due.length === 0 && ahead.deadlines.length === 0 && ahead.meetings.length === 0;

  function toggle(id: number) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function plan() {
    if (checked.size === 0 || planning) return;
    setPlanning(true);
    try {
      await onPlan([...checked]);
      setChecked(new Set());
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {empty ? (
        <EmptyState icon={CalendarClock} text="Nothing due, booked, or planned for next week yet." />
      ) : (
        <>
          {ahead.due.length > 0 && (
            <section>
              <SectionHeading count={ahead.due.length}>Due next week</SectionHeading>
              <List>
                {ahead.due.map((t) => (
                  <Row key={t.id}>
                    <input
                      type="checkbox"
                      className="focus-ring accent-violet w-4 h-4 shrink-0"
                      checked={checked.has(t.id)}
                      onChange={() => toggle(t.id)}
                      aria-label={t.title}
                    />
                    <span className="flex-1 min-w-0 truncate text-[13px]">{t.title}</span>
                    {t.dueDate && <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatShortDate(t.dueDate)}</span>}
                  </Row>
                ))}
              </List>
              <div className="flex justify-end pt-2">
                <Button variant="primary" size="sm" disabled={checked.size === 0 || planning} onClick={() => void plan()}>
                  Plan these
                </Button>
              </div>
            </section>
          )}

          {ahead.deadlines.length > 0 && (
            <section>
              <SectionHeading count={ahead.deadlines.length}>Deadlines</SectionHeading>
              <List>
                {ahead.deadlines.map((d) => (
                  <Row key={d.container.id}>
                    <span className="flex-1 min-w-0 truncate text-[13px]">{d.container.name}</span>
                    <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatShortDate(d.deadline)}</span>
                  </Row>
                ))}
              </List>
            </section>
          )}

          {ahead.meetings.length > 0 && (
            <section>
              <SectionHeading count={ahead.meetings.length}>Already on the calendar</SectionHeading>
              <List>
                {ahead.meetings.map((m) => (
                  <Row key={m.id}>
                    <span className="flex-1 min-w-0 truncate text-[13px]">{m.title}</span>
                    <span className="font-mono text-[11px] text-fg-faint shrink-0">
                      {formatShortDate(localDay(m.startsAt))} {formatClock(m.startsAt)}
                    </span>
                  </Row>
                ))}
              </List>
            </section>
          )}
        </>
      )}

      <section className="flex flex-col gap-1.5">
        <label htmlFor="review-ahead-notes" className="text-[12.5px] text-fg-muted">
          The intention for next week
        </label>
        <Textarea id="review-ahead-notes" rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder="What matters most next week" />
      </section>
    </div>
  );
}
