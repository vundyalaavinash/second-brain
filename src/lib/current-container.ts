"use client";
import { useSyncExternalStore } from "react";

/** The container the open page is about, so a capture from the prompt bar lands there
 * instead of the Inbox. Module state, not context: the bar lives in the shell, above every
 * page that would provide it. */
let current: number | null = null;
const listeners = new Set<() => void>();

export function setCurrentContainer(id: number | null): void {
  current = id;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const onServer = () => null;

export function useCurrentContainer(): number | null {
  return useSyncExternalStore(subscribe, () => current, onServer);
}
