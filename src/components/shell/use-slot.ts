"use client";
import { useSyncExternalStore } from "react";

/** The slot element never changes identity once the shell has mounted, so there is nothing
 * to subscribe to: the store exists only so the target is read during render rather than
 * pushed into state from an effect. */
const noSubscription = () => () => {};

const noSlot = () => null;

/** The portal target with this id, or null on the server and during hydration. */
export function useSlot(id: string): HTMLElement | null {
  return useSyncExternalStore(noSubscription, () => document.getElementById(id), noSlot);
}
