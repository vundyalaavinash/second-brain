"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingDecision } from "@/db/enums";
import type { SeriesAudit } from "@/domain/meetings/audit";
import { formatMinutes, meetingShareLine } from "@/lib/capacity";
import { formatDuration, sinceLabel } from "../activity/format";
import { count } from "../planner/open-meeting";
import { Button, Chip, List, PageHeader } from "../ui";

/** `SeriesAudit` plus the one thing the view needs that the domain type never carries: an
 * occurrence id the "Not going" control can actually write through. `auditSeries` only ever
 * looks backward, so `nextEventId` is resolved separately (`nextOccurrenceIds`) and absent for a
 * one-off (`seriesId === null`) or a series with nothing left scheduled ahead of now. */
export interface AuditRow extends SeriesAudit {
  nextEventId: number | null;
}

interface Props {
  rows: AuditRow[];
  share: { minutes: number; workingMinutes: number };
  /** The window the page's server render actually read (`Math.min(90, retentionDays)`) — named
   * here rather than a hardcoded "ninety days", so a retention setting below the default can
   * never make this page claim to cover more than what still survives to be counted. */
  windowDays: number;
}

const JSON_HEADERS = { "content-type": "application/json" };

/** What ran during it, named rather than guessed -- the one thing only this app can say (design
 * §3), or an honest "nothing recorded" when there is genuinely nothing to name. */
function activityLine(topActivity: SeriesAudit["topActivity"]): string {
  if (topActivity.length === 0) return "No activity was recorded alongside it.";
  // `topActivity[].ms` is milliseconds, the same shape `topApps` always returns -- `formatDuration`,
  // never `formatMinutes` (which wants whole minutes, the shape `totalMinutes` above is in), the
  // same function `activity-line.tsx` already uses on this exact `topApps` output.
  const named = topActivity.map((a) => `${a.label} (${formatDuration(a.ms)})`).join(", ");
  return `Time alongside it went mostly to ${named}.`;
}

/** `sinceLabel`'s relative forms ("just now", "3 min ago", "2 h ago") read fine on their own; its
 * short-date fallback ("14 Sep") does not, and wants the "on" a bare date needs to read as a
 * sentence rather than a fragment. */
function noteRecency(iso: string, now: number): string {
  const label = sinceLabel(iso, now);
  return /ago$|^just now$/.test(label) ? label : `on ${label}`;
}

function notesLine(row: AuditRow, now: number): string {
  const notes = row.lastNoteAt ? `Notes were last written ${noteRecency(row.lastNoteAt, now)}.` : "No notes have ever been taken.";
  const transcript = row.hasTranscript ? "A transcript exists for at least one occurrence." : "No transcript exists.";
  return `${notes} ${transcript}`;
}

function tasksLine(row: AuditRow): string {
  return row.tasksSince > 0 ? `${count(row.tasksSince, "task")} came out of it.` : "Nothing has been assigned from it.";
}

/**
 * The audit (design §7): one line of real argument at the top, then every recurring series that
 * ran in the window read (the last ninety days, or the person's own shorter retention setting),
 * ordered by the hours it took, each carrying the evidence a person needs to ask the five
 * questions themselves. No score, no colour, no "health" label anywhere on this page -- that is
 * the whole point, not an oversight.
 */
export function AuditView({ rows, share, windowDays }: Props) {
  // `sinceLabel` only needs a rough "now" for relative wording, never a ticking clock -- read
  // once per mount, not on every render (the impure-during-render rule this repo's lint enforces),
  // the same way `break-offer.tsx` pins its own one-shot `now`.
  const [now] = useState(() => Date.now());
  const windowLabel = count(windowDays, "day");
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader title="The audit" meta={meetingShareLine(share)} />
      {rows.length === 0 ? (
        <p className="text-[13.5px] text-fg-faint">No meetings in the last {windowLabel} to weigh yet.</p>
      ) : (
        <List className="pane flex flex-col">
          {rows.map((row, i) => (
            // Index, not `row.seriesId ?? title`: two different one-off meetings (both
            // `seriesId: null`) can share a title, and the server computes a stable order for
            // this list on every render, so an index key is safe here.
            <AuditRowView key={i} row={row} now={now} windowLabel={windowLabel} />
          ))}
        </List>
      )}
    </div>
  );
}

function AuditRowView({ row, now, windowLabel }: { row: AuditRow; now: number; windowLabel: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Writes through the same decision path every other meeting control in this app uses
   * (`PATCH /api/meetings/[id]/decision`, Task 2) -- never a route of its own -- against the next
   * known occurrence's own event id, the only one this row has to offer. */
  function decide(decision: MeetingDecision, scope: "occurrence" | "series") {
    if (row.nextEventId === null) return;
    const eventId = row.nextEventId;
    void (async () => {
      const res = await fetch(`/api/meetings/${eventId}/decision`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ decision, scope }) });
      if (!res.ok) {
        setError("Could not save that change");
        return;
      }
      setError(null);
      setAsking(false);
      router.refresh();
    })();
  }

  return (
    <li className="hairline-row flex flex-col gap-1.5 px-3 py-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[14px] font-medium">{row.title}</span>
        <span className="font-mono text-[11.5px] text-fg-faint whitespace-nowrap">
          {count(row.occurrences, "occurrence")} in the last {windowLabel} · {formatMinutes(row.totalMinutes)} total · {row.attendedCount} of {row.occurrences} attended
        </span>
      </div>
      <p className="text-[12.5px] text-fg-muted m-0">
        {activityLine(row.topActivity)} {notesLine(row, now)} {tasksLine(row)}
      </p>
      {row.nextEventId !== null && (
        <div className="flex items-center gap-2 flex-wrap">
          {!asking ? (
            <Chip onClick={() => setAsking(true)} className="h-6 px-2 text-[11.5px]">
              Not going
            </Chip>
          ) : (
            <span role="group" aria-label={`Not going, for ${row.title}`} className="flex items-center gap-2 text-[12px] text-fg-muted flex-wrap">
              Just the next one, or every time this meeting happens?
              <Button size="sm" variant="ghost" onClick={() => decide("not-going", "occurrence")} className="shrink-0">
                Just the next one
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide("not-going", "series")} className="shrink-0">
                Every time
              </Button>
            </span>
          )}
          {error && <span className="text-[11.5px] text-danger">{error}</span>}
        </div>
      )}
    </li>
  );
}
