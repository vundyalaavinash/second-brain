"use client";

import { useState } from "react";
import type { HomeItemDTO, PlannerDayDTO } from "@/lib/dto";
import { formatMinutes } from "@/lib/capacity";
import { addDaysLocal, formatClock } from "../activity/format";
import { Button, Chip } from "../ui";
import { blocksOn } from "../planner/block-math";
import { count } from "../planner/open-meeting";
import { useRecorder } from "../planner/use-recorder";

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE_ERROR = "Could not save that change";

/**
 * Both spellings of a start read the same here: a meeting's instant is UTC and a session's is
 * local wall clock, and `new Date` reads each as its own source meant it.
 */
const clock = (iso: string) => formatClock(iso);

/** What the day would be told to fill, and whether anything is waiting to be filled in. */
function nothingPlaced(day: PlannerDayDTO): boolean {
  return day.plan.every((t) => blocksOn(t, day.date).length === 0) && day.plan.some((t) => t.estimateMinutes !== null);
}

interface Props {
  day: PlannerDayDTO;
  now: HomeItemDTO | null;
  next: HomeItemDTO[];
}

/**
 * What is happening now, what stands under it, and — on a day whose plan has nowhere to go
 * yet — the one button that gives it somewhere. The current item is a status region, so a
 * reader hears the meeting that has just begun without being dragged to it.
 */
export function NowNext({ day, now, next }: Props) {
  const [error, setError] = useState<string | null>(null);
  const recorder = useRecorder();
  // The dock's chip owns a running session; here it is only news, in place of the button that
  // could no longer start anything.
  const recording = recorder.status.state === "recording" || recorder.status.state === "stopping";

  /** Ticks off the task a session in progress belongs to; the day comes back off the event. */
  function done(taskId: number) {
    void (async () => {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: "done" }) });
      if (!res.ok) {
        setError(SAVE_ERROR);
        return;
      }
      setError(null);
      window.dispatchEvent(new Event("sb:tasks-changed"));
    })();
  }

  /**
   * Fill the day, the Planner's own run, said from here: every unplaced plan task's sessions
   * into whatever the calendar leaves. The toast is the Planner's too, offer and all — what
   * today had no room for can go on tomorrow.
   */
  async function place(date: string, offerNext: boolean) {
    const res = await fetch("/api/plan/place", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ date }) });
    if (!res.ok) {
      setError(SAVE_ERROR);
      return;
    }
    // The sessions are written whatever comes back, so the day is read back before the answer
    // is unpacked: a body that cannot be read costs the toast, never the placement.
    window.dispatchEvent(new Event("sb:tasks-changed"));
    const answer = (await res.json().catch(() => null)) as { placed: number; unplacedMinutes: number } | null;
    if (!answer) {
      setError(SAVE_ERROR);
      return;
    }
    setError(null);
    const { placed, unplacedMinutes } = answer;
    const text =
      placed === 0
        ? "Nothing to place"
        : unplacedMinutes > 0
          ? `Placed ${count(placed, "session")}, ${formatMinutes(unplacedMinutes)} unplaced`
          : `Placed ${count(placed, "session")}`;
    // Only the first run offers the next day; a second offer would walk the work off into a
    // week nobody asked about.
    const action = offerNext && unplacedMinutes > 0 ? { label: "Place tomorrow", onClick: () => void place(addDaysLocal(date, 1), false) } : undefined;
    window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text, action } }));
  }

  function current() {
    if (!now) return <span className="text-[13px] text-fg-faint">Nothing on right now</span>;
    if (now.kind === "session") {
      return (
        <>
          <input
            type="checkbox"
            className="focus-ring accent-violet w-4 h-4 shrink-0"
            checked={false}
            aria-label={now.title}
            onChange={() => now.taskId !== undefined && done(now.taskId)}
          />
          <span className="flex-1 min-w-0 truncate text-[14px]">{now.title}</span>
          <span className="font-mono text-[11px] text-fg-faint shrink-0">Ends {clock(now.endsAt)}</span>
        </>
      );
    }
    return (
      <>
        <span className="flex-1 min-w-0 truncate text-[14px]">{now.title}</span>
        <span className="font-mono text-[11px] text-fg-faint shrink-0">Ends {clock(now.endsAt)}</span>
        {now.joinUrl && (
          <Button href={now.joinUrl} size="sm" variant="ghost" target="_blank" rel="noreferrer" aria-label={`Join ${now.title}`} className="shrink-0">
            Join
          </Button>
        )}
        {recording ? (
          <Chip as="span" className="shrink-0">
            {recorder.status.state === "stopping" ? "Stopping" : "Recording"}
          </Chip>
        ) : (
          // A disabled button takes no pointer events, so the reason hangs on a wrapper.
          <span title={recorder.title ?? undefined} className="shrink-0">
            <Button
              size="sm"
              onClick={() => recorder.record(now.meetingId !== undefined ? { calendarEventId: now.meetingId } : { adhoc: true })}
              disabled={!!recorder.blocked}
              title={recorder.title ?? undefined}
              aria-label={`Record ${now.title}`}
            >
              Record
            </Button>
          </span>
        )}
      </>
    );
  }

  return (
    <section aria-label="Now" className="pane p-4 flex flex-col gap-3">
      <span className="micro">Now</span>
      {/* Spec §5: the one region that speaks up, and only when what is on has changed. */}
      <div role="status" className="flex items-center gap-3 min-h-8 flex-wrap">
        {current()}
      </div>

      {next.length > 0 && (
        <ul aria-label="Next" className="list-none m-0 p-0 flex flex-col">
          {next.map((item) => (
            <li key={`${item.kind}-${item.meetingId ?? item.blockId}`} className="hairline-row flex items-center gap-3 py-1.5 min-w-0">
              <span className="font-mono text-[11px] text-fg-faint shrink-0 w-10">{clock(item.startsAt)}</span>
              <span className="flex-1 min-w-0 truncate text-[13px] text-fg-muted">{item.title}</span>
            </li>
          ))}
        </ul>
      )}

      {nothingPlaced(day) && (
        <div className="flex items-center gap-3 rounded-md bg-layer-2 border border-hairline px-3 py-2">
          <span className="text-[12.5px] text-fg-muted flex-1 min-w-0">Nothing placed yet</span>
          <Button size="sm" onClick={() => void place(day.date, true)}>
            Place in free slots
          </Button>
        </div>
      )}

      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
