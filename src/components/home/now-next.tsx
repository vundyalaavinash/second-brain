"use client";

import { useState } from "react";
import type { FocusRunDTO, HomeDTO, HomeItemDTO, PlannerDayDTO } from "@/lib/dto";
import { formatClock, formatDuration } from "../activity/format";
import { Button, Chip } from "../ui";
import { blocksOn } from "../planner/block-math";
import { placeDay, SAVE_ERROR } from "../planner/place-day";
import { useRecorder } from "../planner/use-recorder";
import { useFocus } from "../focus/use-focus";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Both spellings of a start read the same here: a meeting's instant is UTC and a session's is
 * local wall clock, and `new Date` reads each as its own source meant it.
 */
const clock = (iso: string) => formatClock(iso);

/** What the day would be told to fill, and whether anything is waiting to be filled in. Only
 * open rows count: filling the day never places a task that is already done. */
function nothingPlaced(day: PlannerDayDTO): boolean {
  const open = day.plan.filter((t) => t.status === "open");
  return open.every((t) => blocksOn(t, day.date).length === 0) && open.some((t) => t.estimateMinutes !== null);
}

interface Props {
  day: PlannerDayDTO;
  /** The day the app is being used on, so the fill's offer can name the day it means. */
  today: string;
  now: HomeItemDTO | null;
  next: HomeItemDTO[];
  focus: HomeDTO["focus"];
}

/** The run's remaining time, from its own planned end — the same arithmetic `focus-store.ts`
 * runs, recomputed here rather than imported so this reads correctly even before that store's
 * own fetch has caught up with what the page was handed on its first paint. */
function remainingFor(run: FocusRunDTO): number {
  return Math.max(0, Date.parse(run.startedAt) + run.plannedMinutes * 60_000 - Date.now());
}

/**
 * What is happening now, what stands under it, and — on a day whose plan has nowhere to go
 * yet — the one button that gives it somewhere. The current item is a status region, so a
 * reader hears the meeting that has just begun without being dragged to it.
 */
export function NowNext({ day, today, now, next, focus }: Props) {
  const [error, setError] = useState<string | null>(null);
  const recorder = useRecorder();
  // The one store every focus surface reads — no fetch of its own. Its own run wins once it
  // has loaded; until then the payload's own `focus.running` keeps the first paint honest.
  const { run: liveRun, finish, busy: focusBusy } = useFocus();
  const activeRun = liveRun ?? focus.running;
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

  /** Fill the day, the Planner's own run said from here: one helper holds the request, the
   * announcement, the three-way toast and the offer of the next day. */
  const place = () => void placeDay(day.date, { today, offerNext: true, onError: setError });

  function current() {
    // A meeting is where the person has to be, whatever else is running; short of that, a live
    // run wins the slot over a session — the person is demonstrably working on that one.
    if (now?.kind !== "meeting" && activeRun) {
      return (
        <>
          <span className="flex-1 min-w-0 truncate text-[14px]">{activeRun.taskTitle}</span>
          <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatDuration(remainingFor(activeRun))} left</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void finish("stopped")}
            disabled={focusBusy}
            aria-label={`Stop focusing on ${activeRun.taskTitle}`}
            className="shrink-0"
          >
            Stop
          </Button>
        </>
      );
    }
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
          <Button size="sm" onClick={place}>
            Place in free slots
          </Button>
        </div>
      )}

      {/* The recorder speaks for itself the way the meetings list lets it. */}
      {(error ?? recorder.error) && <p className="text-danger text-[12.5px] m-0">{error ?? recorder.error}</p>}
    </section>
  );
}
