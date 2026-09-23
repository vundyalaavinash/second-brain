"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, as an external store: the server and the first client render
 * say no, and a resize that crosses the query re-renders. Without `matchMedia` (jsdom) it is
 * simply never true.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
