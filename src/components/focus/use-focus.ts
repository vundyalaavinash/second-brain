"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusRunDTO, FocusSettingsDTO } from "@/lib/dto";
import type { FocusOutcome } from "@/db/enums";

/** Slow enough to cost nothing: nothing but this browser starts a run, so the poll exists only
 * to notice one started in another tab — the same shape as `useRecorder`'s own poll. */
const POLL_MS = 60_000;
const TICK_MS = 1000;

const DEFAULT_SETTINGS: FocusSettingsDTO = { defaultMinutes: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };

export interface StartFocusInput {
  taskId: number;
  /** The session this run belongs to. Its own length is used unless `minutes` overrides it —
   * never recomputed here from the block's own minutes, which the server already knows. */
  blockId?: number | null;
  minutes?: number;
}

/** What `sb:focus-completed` carries: a natural completion (never a stop or an abandon), the
 * count of the day's completions including this one, and the settings that say how long a
 * break is. Dispatched app-wide rather than kept as hook state, because the run that just
 * finished and the break offer that reads it are almost never the same `useFocus` instance —
 * a task row's button and the dock's chip each own their own. */
export interface FocusCompletedDetail {
  run: FocusRunDTO;
  completedToday: number;
  settings: FocusSettingsDTO;
}

interface FocusState {
  run: FocusRunDTO | null;
  settings: FocusSettingsDTO;
  completedToday: number;
}

const EMPTY_STATE: FocusState = { run: null, settings: DEFAULT_SETTINGS, completedToday: 0 };

/** The run's planned end, in epoch ms — the one place it is computed, so the countdown and the
 * auto-finish check can never disagree about when zero is reached. */
function plannedEnd(run: FocusRunDTO): number {
  return Date.parse(run.startedAt) + run.plannedMinutes * 60_000;
}

export interface UseFocusResult {
  run: FocusRunDTO | null;
  settings: FocusSettingsDTO;
  completedToday: number;
  /** Milliseconds left in the live run, zero while idle. Ticks once a second; never asks the
   * server to recompute it. */
  remainingMs: number;
  start: (input: StartFocusInput) => void;
  finish: (outcome: FocusOutcome) => void;
  busy: boolean;
  error: string | null;
}

/**
 * The one hook that owns the live focus run. It asks `/api/focus` on mount, whenever any write
 * anywhere dispatches `sb:focus-changed`, and every minute besides. While a run is live, a
 * one-second tick recomputes `remainingMs` from `startedAt` and `plannedMinutes` rather than
 * asking the server again; reaching zero finishes the run as "completed" exactly once, guarded
 * by a ref holding the id already being finished — a piece of state would not update until the
 * next render, letting the following tick read the guard as still open and fire the PATCH a
 * second time.
 */
export function useFocus(): UseFocusResult {
  const [state, setState] = useState<FocusState>(EMPTY_STATE);
  // Ticks once a second while a run is live; `remainingMs` below is derived from it at render
  // rather than stored itself, so the tick's own setState never runs synchronously in an effect
  // body — only inside the interval's callback.
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishing = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/focus", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as FocusState;
        if (!cancelled) setState(data);
      } catch {
        /* offline: the next poll or event retries */
      }
    }
    void load();
    const onChanged = () => void load();
    window.addEventListener("sb:focus-changed", onChanged);
    const poll = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("sb:focus-changed", onChanged);
      clearInterval(poll);
    };
  }, []);

  const run = state.run;

  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [run]);

  const remainingMs = run ? Math.max(0, plannedEnd(run) - now) : 0;

  const finishRun = useCallback(async (id: number, outcome: FocusOutcome) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/focus/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body as { error?: string } | null)?.error ?? "Could not finish the run");
        return;
      }
      const finished = (body as { run: FocusRunDTO }).run;
      setError(null);
      // Captured from the updater, which React runs synchronously: the count and settings as
      // they stood the instant before this run left `state`, so "including this one" below is
      // exact rather than a guess at whatever the next poll happens to see.
      let priorCompletedToday = 0;
      let settingsNow = DEFAULT_SETTINGS;
      setState((s) => {
        priorCompletedToday = s.completedToday;
        settingsNow = s.settings;
        return { ...s, run: null };
      });
      if (finished.outcome === "completed") {
        window.dispatchEvent(
          new CustomEvent<FocusCompletedDetail>("sb:focus-completed", {
            detail: { run: finished, completedToday: priorCompletedToday + 1, settings: settingsNow },
          }),
        );
      }
    } catch {
      setError("Could not finish the run");
    } finally {
      setBusy(false);
      finishing.current = null;
      window.dispatchEvent(new Event("sb:focus-changed"));
    }
  }, []);

  // The auto-finish: once the tick above carries `remainingMs` to zero, the run is closed as
  // "completed". `finishing` is set synchronously, in the same pass that reads it, so a second
  // tick landing before the PATCH resolves sees the guard already up.
  useEffect(() => {
    if (!run || remainingMs > 0) return;
    if (finishing.current === run.id) return;
    finishing.current = run.id;
    void finishRun(run.id, "completed");
  }, [run, remainingMs, finishRun]);

  const start = useCallback((input: StartFocusInput) => {
    setBusy(true);
    void (async () => {
      try {
        const res = await fetch("/api/focus", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError((body as { error?: string } | null)?.error ?? "Could not start a run");
          return;
        }
        setError(null);
        setState((s) => ({ ...s, run: body as FocusRunDTO }));
      } catch {
        setError("Could not start a run");
      } finally {
        setBusy(false);
        window.dispatchEvent(new Event("sb:focus-changed"));
      }
    })();
  }, []);

  const finish = useCallback(
    (outcome: FocusOutcome) => {
      if (!run) return;
      finishing.current = run.id;
      void finishRun(run.id, outcome);
    },
    [run, finishRun],
  );

  return {
    run,
    settings: state.settings,
    completedToday: state.completedToday,
    remainingMs,
    start,
    finish,
    busy,
    error,
  };
}
