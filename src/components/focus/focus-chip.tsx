"use client";

import { useFocus } from "./use-focus";

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The one thing on screen that says a focus run is live, beside the recording chip. `useFocus`
 * owns the run; this only shows it and offers to stop it. A focus run is opt-in, so unlike the
 * recorder's chip there is no idle state worth drawing — nothing renders until one is live.
 */
export function FocusChip() {
  const { run, remainingMs, finish, busy } = useFocus();

  if (!run) return null;

  // The same event `task-row.tsx`'s own "Blocked at" chip dispatches: the timeline, when it is
  // mounted, scrolls to and focuses the session; anywhere else it is a no-op rather than a dead
  // link to a page tasks do not otherwise have.
  function goToTask() {
    window.dispatchEvent(new CustomEvent("sb:timeline-focus", { detail: { taskId: run!.taskId, blockId: run!.blockId ?? undefined } }));
  }

  return (
    <div className="panel rounded-full h-11 px-3 flex items-center gap-2 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full shrink-0 bg-violet-bright motion-safe:animate-pulse" aria-hidden />
      {/* Outside the live region and hidden from it: a clock that ticks inside one would be
        * announced every second. */}
      <span className="font-mono text-[12px] text-fg-muted tabular-nums" aria-hidden>
        {clock(remainingMs)}
      </span>
      <span role="status" aria-live="polite" className="min-w-0">
        <button
          type="button"
          onClick={goToTask}
          className="focus-ring rounded-sm text-[12.5px] truncate max-w-[22ch] hover:underline"
        >
          {run.taskTitle}
        </button>
      </span>
      <button
        type="button"
        onClick={() => finish("stopped")}
        disabled={busy}
        aria-label={`Stop focusing on ${run.taskTitle}`}
        className="focus-ring rounded-sm h-7 px-2 text-[12px] border border-hairline hover:border-hairline-strong transition-colors disabled:opacity-40"
      >
        Stop
      </button>
    </div>
  );
}
