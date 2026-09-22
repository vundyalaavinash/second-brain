"use client";
import { useSyncExternalStore } from "react";

/** The container the open page is about, so a capture from the prompt bar lands there
 * instead of the Inbox. Module state, not context: the bar lives in the shell, above every
 * page that would provide it. The name rides along so a toast can say where it went. */
export interface CurrentContainer {
  id: number;
  name: string;
}

let current: CurrentContainer | null = null;
const listeners = new Set<() => void>();

export function setCurrentContainer(container: CurrentContainer | null): void {
  current = container;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const onServer = () => null;

export function useCurrentContainer(): CurrentContainer | null {
  return useSyncExternalStore(subscribe, () => current, onServer);
}
