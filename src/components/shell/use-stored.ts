"use client";
import { useSyncExternalStore } from "react";

/** `localStorage` only fires `storage` in *other* tabs, so writes from this one are
 * announced to these listeners by hand. */
const listeners = new Set<() => void>();

/** Holds the value for the session when storage is unavailable (private mode), so a
 * toggle still works even though it will not survive a reload. */
const fallback = new Map<string, string>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return fallback.get(key) ?? null;
  }
}

const unavailable = () => null;

/** The raw string stored under `key`, or null on the server, during hydration, and when
 * nothing is stored. */
export function useStored(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), unavailable);
}

/** Writes `key` and re-renders every `useStored` reading it in this tab. */
export function setStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    fallback.set(key, value);
  }
  for (const listener of [...listeners]) listener();
}
