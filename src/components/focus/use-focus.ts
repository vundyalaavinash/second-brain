"use client";

import { useSyncExternalStore } from "react";
import type { FocusRunDTO, FocusSettingsDTO } from "@/lib/dto";
import type { FocusOutcome } from "@/db/enums";
import * as store from "./focus-store";

export type { StartFocusInput, FocusCompletedDetail } from "./focus-store";

export interface UseFocusResult {
  run: FocusRunDTO | null;
  settings: FocusSettingsDTO;
  completedToday: number;
  /** Milliseconds left in the live run, zero while idle. Ticks once a second; never asks the
   * server to recompute it. */
  remainingMs: number;
  /** Resolves once the write settles — never rejects — so a caller that needs to sequence a
   * stop and a start (`⌘⇧F` switching tasks) can await it; a click handler is free to not. */
  start: (input: store.StartFocusInput) => Promise<void>;
  finish: (outcome: FocusOutcome) => Promise<void>;
  busy: boolean;
  error: string | null;
}

/**
 * The one hook every focus surface reads from — a thin `useSyncExternalStore` subscription onto
 * `focus-store.ts`'s single module-level run. Mounting this a hundred times over still makes
 * one fetch, keeps one poll and one tick running, and finishes a completed run exactly once:
 * the store, not this hook, is what owns any of that.
 */
export function useFocus(): UseFocusResult {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    run: state.run,
    settings: state.settings,
    completedToday: state.completedToday,
    remainingMs: state.remainingMs,
    start: store.start,
    finish: store.finish,
    busy: state.busy,
    error: state.error,
  };
}
