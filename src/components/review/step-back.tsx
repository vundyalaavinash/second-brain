"use client";

import { CalendarX } from "lucide-react";
import type { ReviewDTO } from "@/lib/dto";
import { formatMinutes } from "@/lib/capacity";
import { EmptyState, List, Row, SectionHeading, Textarea } from "../ui";

const ROW_LABEL = "text-[12.5px] text-fg-muted";
const ROW_VALUE = "font-mono text-[13px] text-fg";

/**
 * Second step: what the week actually did, read off the same figures Home and the Planner
 * already compute — a small table, not a paragraph re-deriving them in prose.
 */
export function StepBack({ back, value, onChange }: { back: ReviewDTO["back"]; value: string; onChange: (value: string) => void }) {
  const empty = back.done === 0 && back.dropped === 0 && back.slipped === 0 && back.focusMinutes === 0 && back.meetings === 0 && back.projects.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionHeading>The week in figures</SectionHeading>
        {empty ? (
          <EmptyState icon={CalendarX} text="Nothing was planned this week." />
        ) : (
          <table className="w-full border-collapse">
            <caption className="sr-only">The week&apos;s figures</caption>
            <tbody>
              {(
                [
                  ["Done", back.done],
                  ["Dropped", back.dropped],
                  ["Still open", back.slipped],
                  ["Focus time", `${formatMinutes(back.focusMinutes)} over ${back.focusRuns} run${back.focusRuns === 1 ? "" : "s"}`],
                  ["Meetings", back.meetings],
                ] as const
              ).map(([label, val]) => (
                <tr key={label} className="hairline-row">
                  <th scope="row" className={`${ROW_LABEL} text-left font-normal py-1.5`}>
                    {label}
                  </th>
                  <td className={`${ROW_VALUE} text-right py-1.5`}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {back.projects.length > 0 && (
        <section>
          <SectionHeading count={back.projects.length}>Projects that moved</SectionHeading>
          <List>
            {back.projects.map((p) => (
              <Row key={p.container.id}>
                <span className="flex-1 min-w-0 truncate text-[13px]">{p.container.name}</span>
                <span className="font-mono text-[12px] text-fg-muted shrink-0">{p.closed} closed</span>
                <span className="font-mono text-[12px] text-fg-faint shrink-0">{p.percent}%</span>
              </Row>
            ))}
          </List>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <label htmlFor="review-back-notes" className="text-[12.5px] text-fg-muted">
          How did the week go
        </label>
        <Textarea id="review-back-notes" rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder="What stands out, looking back" />
      </section>
    </div>
  );
}
