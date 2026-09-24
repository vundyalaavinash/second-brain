"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM } from "./nav";
import { useFocus } from "./focus/use-focus";

const SEQUENCE_WINDOW_MS = 900;

/** True when the key belongs to whatever the user is editing, so a bare-letter shortcut
 * must stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** The task (and, on the timeline, the session) the keyboard is sitting on: the row and the
 * block both carry it as a data attribute, so this asks the DOM rather than tracking a second,
 * shadow copy of "what's focused" that could drift from what focus actually is. */
function focusedTask(target: EventTarget | null): { taskId: number; blockId?: number } | null {
  const el = target as HTMLElement | null;
  if (!el) return null;
  const block = el.closest<HTMLElement>("[data-task-block]");
  if (block) {
    const taskId = Number(block.dataset.taskBlock);
    const blockId = Number(block.dataset.blockId);
    if (Number.isFinite(taskId)) return { taskId, blockId: Number.isFinite(blockId) ? blockId : undefined };
  }
  const row = el.closest<HTMLElement>("[data-task-id]");
  if (row) {
    const taskId = Number(row.dataset.taskId);
    if (Number.isFinite(taskId)) return { taskId };
  }
  return null;
}

/** The one window-level key handler: `g` then a letter jumps between views, `/` focuses the
 * search box when present, a bare `c` calls the prompt bar to the front, and `⌘⇧F` starts a
 * focus run on whatever task the keyboard sits on — or stops the one already running. */
export function Shortcuts() {
  const router = useRouter();
  const { run, start, finish } = useFocus();
  useEffect(() => {
    let pendingG = 0;
    const byLetter = new Map([...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM].map((n) => [n.shortcut.split(" ")[1], n.href]));
    function onKey(e: KeyboardEvent) {
      // A chord, checked on its own before the plain-letter guard below turns any modifier
      // away: `⌘⇧F` (or `Ctrl⇧F`, off Mac) works from wherever the keyboard already sits,
      // the same as the command palette's own `⌘K` does.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (run) {
          finish("stopped");
          return;
        }
        const task = focusedTask(e.target);
        if (task) start(task);
        return;
      }
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
          return;
        }
      }
      // `c` on its own (the `g c` sequence above has already claimed its own `c`) puts the
      // caret in the prompt bar, wherever in the shell it is mounted.
      if (e.key === "c") {
        e.preventDefault();
        window.dispatchEvent(new Event("sb:prompt-focus"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, run, start, finish]);
  return null;
}
