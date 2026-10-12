"use client";

import { Coffee, Play, Square, Timer } from "lucide-react";
import type { PlanTaskDTO } from "@/lib/dto";
import { Button } from "../ui";
import { useFocus } from "../focus/use-focus";

/** mm:ss from milliseconds, for a clock that is read at a glance rather than parsed. */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * How far through the cycle today is, as one dot per pomodoro up to the long break.
 *
 * The count is the whole point of a cycle and it was invisible: the settings have said
 * `longBreakEvery: 4` since the feature shipped and `break-offer.tsx` has quietly used it to pick
 * the long break, but nothing ever showed how close the next one was. Dots rather than "3 / 4"
 * because this is glanced at, and because a row of four reads as a rhythm where a fraction reads
 * as a score.
 */
function CycleDots({ done, every }: { done: number; every: number }) {
  const position = every > 0 ? done % every : 0;
  // A completed cycle lands on 0; it is a full row, not an empty one.
  const filled = done > 0 && position === 0 ? every : position;
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`${filled} of ${every} before a long break`}>
      {Array.from({ length: every }, (_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i < filled ? "bg-violet-bright" : "bg-hairline"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * The pomodoro timer as its own pane, rather than a control hidden on whichever task row happens
 * to be on screen.
 *
 * Everything it drives already existed -- runs, the 25/5/15/4 defaults, the long-break cycle --
 * but only as a button per task and a toast after one finished. What it adds is a place to see
 * the phase you are in, how far through the cycle you are, and a break that is not lost the
 * moment you navigate.
 */
export function PomodoroPane({ nextTask }: { nextTask: PlanTaskDTO | null }) {
  const { run, settings, completedToday, remainingMs, breakState, start, finish, takeBreak, endBreak, busy, error } = useFocus();

  const onBreak = breakState.endsAt !== null;
  const isLong = onBreak && breakState.minutes >= settings.longBreak;

  return (
    <section className="pane p-3 flex flex-col gap-2" aria-label="Pomodoro">
      <header className="flex items-center gap-2">
        {onBreak ? <Coffee className="w-4 h-4 text-fg-muted shrink-0" aria-hidden /> : <Timer className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />}
        <span className="text-[12.5px]">{onBreak ? (isLong ? "Long break" : "Short break") : run ? "Focusing" : "Pomodoro"}</span>
        <span className="flex-1" />
        <CycleDots done={completedToday} every={settings.longBreakEvery} />
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        {/* One clock, whichever phase is running: tabular so the digits do not shuffle each second. */}
        {(run || onBreak) && (
          <span className="font-mono tabular-nums text-[22px] leading-none" aria-live="off">
            {clock(onBreak ? breakState.remainingMs : remainingMs)}
          </span>
        )}

        {run ? (
          <>
            <span className="flex-1 min-w-[10ch] text-[12.5px] text-fg-muted truncate" title={run.taskTitle}>
              {run.taskTitle}
            </span>
            <Button size="sm" variant="ghost" icon={Square} disabled={busy} onClick={() => void finish("completed")}>
              Stop
            </Button>
          </>
        ) : onBreak ? (
          <>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" icon={Play} disabled={busy} onClick={() => void endBreak()}>
              Back to work
            </Button>
          </>
        ) : (
          <>
            {/* Nothing running. A pomodoro needs something to be about, so this offers the next
                thing already planned rather than asking for a decision here. */}
            {nextTask ? (
              <Button
                size="sm"
                variant="primary"
                icon={Play}
                disabled={busy}
                onClick={() => void start({ taskId: nextTask.id, minutes: settings.defaultMinutes })}
              >
                {`${settings.defaultMinutes}m on ${nextTask.title}`}
              </Button>
            ) : (
              <span className="flex-1 text-[12.5px] text-fg-faint">Plan something for today and it can be started from here</span>
            )}
            <Button size="sm" variant="ghost" icon={Coffee} disabled={busy} onClick={() => void takeBreak()}>
              Break
            </Button>
          </>
        )}
      </div>

      {error && <p className="m-0 text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}
