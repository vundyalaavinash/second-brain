"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { RecorderStatusDTO } from "@/lib/dto";

const POLL_MS = 5000;
const TICK_MS = 1000;

const IDLE: RecorderStatusDTO = { state: "idle", missing: [] };

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The one thing on screen that says a recording is running, beside the dock pill. It asks the
 * recorder where it stands on mount, whenever something says the session changed, and every
 * five seconds while a session is alive; an idle recorder is nothing to show, so it renders
 * nothing and stops asking.
 */
export function RecordingChip() {
  const [status, setStatus] = useState<RecorderStatusDTO>(IDLE);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);

  const post = useCallback((path: string) => {
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(path, { method: "POST" });
        if (res.ok) {
          setStatus((await res.json()) as RecorderStatusDTO);
          setNow(Date.now());
        }
      } catch {
        /* offline: the poll below catches up */
      } finally {
        setBusy(false);
        window.dispatchEvent(new Event("sb:recording-changed"));
      }
    })();
  }, []);

  // Idle is the resting state, and it costs nothing: no poll, no clock, no markup.
  const idle = status.state === "idle";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/meetings/recorder", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        setStatus((await res.json()) as RecorderStatusDTO);
        setNow(Date.now());
      } catch {
        /* offline: the next poll tries again */
      }
    }
    void load();
    const onChanged = () => void load();
    window.addEventListener("sb:recording-changed", onChanged);
    // A live session is worth asking after; an idle recorder only changes on the event above.
    const timer = idle ? null : setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("sb:recording-changed", onChanged);
    };
  }, [idle]);

  useEffect(() => {
    if (idle || !status.startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [idle, status.startedAt]);

  if (idle) return null;

  const failed = status.state === "error";
  const elapsed = status.startedAt ? clock(now - Date.parse(status.startedAt)) : null;

  return (
    <div className="panel rounded-full h-11 px-3 flex items-center gap-2 whitespace-nowrap">
      <span
        data-testid="recording-dot"
        className={`w-2 h-2 rounded-full shrink-0 ${failed ? "bg-fg-faint" : "bg-danger motion-safe:animate-pulse"}`}
        aria-hidden
      />
      <span role="status" aria-live="polite" className="flex items-center gap-2 min-w-0">
        {failed ? (
          <span className="text-[12.5px] text-danger truncate max-w-[28ch]">{status.error ?? "Recording failed"}</span>
        ) : (
          <>
            {elapsed && <span className="font-mono text-[12px] text-fg-muted tabular-nums">{elapsed}</span>}
            {status.itemId ? (
              <Link href={`/items/${status.itemId}`} className="focus-ring rounded-sm text-[12.5px] truncate max-w-[22ch] hover:underline">
                {status.title ?? "Recording"}
              </Link>
            ) : (
              <span className="text-[12.5px] truncate max-w-[22ch]">{status.title ?? "Recording"}</span>
            )}
            {status.state === "stopping" && <span className="text-[12px] text-fg-faint">Stopping</span>}
          </>
        )}
      </span>
      {!failed && status.autoStarted && !status.keep && (
        <button
          type="button"
          onClick={() => post("/api/meetings/recorder/keep")}
          disabled={busy}
          className="focus-ring rounded-sm h-7 px-2 text-[12px] text-fg-muted hover:text-fg hover:bg-layer-2 transition-colors disabled:opacity-40"
        >
          Keep recording
        </button>
      )}
      <button
        type="button"
        onClick={() => post("/api/meetings/recorder/stop")}
        disabled={busy || status.state === "stopping"}
        aria-label={failed ? "Dismiss recording error" : "Stop recording"}
        className="focus-ring rounded-sm h-7 px-2 text-[12px] border border-hairline hover:border-hairline-strong transition-colors disabled:opacity-40"
      >
        {failed ? "Dismiss" : "Stop"}
      </button>
    </div>
  );
}
