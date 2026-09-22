"use client";
import { useSyncExternalStore } from "react";

/** The day the open Planner is showing, so a task added from the prompt bar lands on that plan
 * instead of nowhere. Module state, not context: the bar lives in the shell, above the page
 * that would provide it. Null means no plan is open and the bar just adds the task. */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setPlanDate(date: string | null): void {
  current = date;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const onServer = () => null;

export function usePlanDate(): string | null {
  return useSyncExternalStore(subscribe, () => current, onServer);
}
