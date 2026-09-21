"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS, CAPTURE_ITEM } from "./nav";

const SEQUENCE_WINDOW_MS = 900;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** `g` then a letter jumps between views; `/` focuses the search box when present. */
export function Shortcuts() {
  const router = useRouter();
  useEffect(() => {
    let pendingG = 0;
    const byLetter = new Map([...NAV_ITEMS, CAPTURE_ITEM].map((n) => [n.shortcut.split(" ")[1], n.href]));
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target)) return;
      if (e.key === "/") {
        const input = document.getElementById("search-input") as HTMLInputElement | null;
        if (input) {
          e.preventDefault();
          input.focus();
        } else {
          router.push("/search");
        }
        return;
      }
      const now = Date.now();
      if (e.key === "g") {
        pendingG = now;
        return;
      }
      if (pendingG && now - pendingG < SEQUENCE_WINDOW_MS) {
        const href = byLetter.get(e.key);
        pendingG = 0;
        if (href) {
          e.preventDefault();
          router.push(href);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}
