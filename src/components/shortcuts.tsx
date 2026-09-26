"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM } from "./nav";
import { useFocus, type UseFocusResult } from "./focus/use-focus";

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
  // Not an element — the window itself, say, when nothing on the page has focus — has no
  // `closest` to walk up from.
  if (!(target instanceof Element)) return null;
  const el = target;
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
 * focus run on whatever task the keyboard sits on, switches it to a different one, or stops it. */
export function Shortcuts() {
  const router = useRouter();
  const focus = useFocus();
  // Read inside the handler rather than closed over: keeps the listener registered for the
  // component's whole lifetime instead of tearing it down and rebuilding it on every tick of
  // whatever run is live, the same problem `run` in a dependency array would cause here. Written
  // from its own effect, never during render, which refs may not be.
  const focusRef = useRef<UseFocusResult>(focus);
  useEffect(() => {
    focusRef.current = focus;
  });
  useEffect(() => {
    let pendingG = 0;
    const byLetter = new Map([...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM].map((n) => [n.shortcut.split(" ")[1], n.href]));
    function onKey(e: KeyboardEvent) {
      // A chord, checked on its own before the plain-letter guard below turns any modifier
      // away: `⌘⇧F` (or `Ctrl⇧F`, off Mac) works from wherever the keyboard already sits, the
      // same as the command palette's own `⌘K` does — but it still has no business starting a
      // run out from under someone renaming a task, so it bails on a typing target exactly like
      // the plain-letter shortcuts below do, and before `preventDefault` rather than after.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        if (isTyping(e.target)) return;
        e.preventDefault();
        const { run, start, finish } = focusRef.current;
        const task = focusedTask(e.target);
        if (run) {
          // A different task under the keyboard: stop the incumbent and start the new one in
          // the same press, design §4.6's "starting a second stops the first". The same task —
          // or nothing at all — is just a stop; a second press is what starts it again. The
          // start is sequenced after the stop settles rather than fired alongside it: unordered,
          // whichever response lands last would win, flickering the chip between the two tasks.
          void (async () => {
            await finish("stopped");
            if (task && task.taskId !== run.taskId) await start(task);
          })();
          return;
        }
        if (task) void start(task);
        return;
      }
      // `?` is Shift+/ on a standard layout, so it has to be checked before the plain-letter
      // guard below turns every shifted key away -- the same reason the focus chord above is
      // checked on its own first. No other modifier is allowed, and it still bails on a typing
      // target: someone asking "what does this do?" mid-sentence should get a question mark.
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "?") {
        if (isTyping(e.target)) return;
        e.preventDefault();
        router.push("/help");
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
  }, [router]);
  return null;
}
