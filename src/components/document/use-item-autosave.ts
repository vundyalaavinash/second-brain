"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemDTO } from "@/lib/dto";

/** The item editor's interval, kept the same so both pages say the same thing about saving. */
export const SAVE_DEBOUNCE_MS = 5000;

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "Unsaved, autosaves in 5 s",
  saving: "Saving",
  saved: "Saved",
  error: "Save failed",
};

export interface ItemAutosave {
  /** The item as the server last returned it. */
  item: ItemDTO;
  title: string;
  body: string;
  save: SaveState;
  saveLabel: string;
  setTitle: (next: string) => void;
  setBody: (next: string) => void;
  /** Write now. `keepalive` is for the unmount flush, which outlives the page. */
  persist: (keepalive?: boolean) => Promise<void>;
  /** Fold a freshly fetched item in: a poll's answer, not an edit. */
  syncFromServer: (next: ItemDTO) => void;
}

/**
 * The item editor's autosave for the two fields a meeting page edits. It is a copy of that
 * component's persist/dirty/interval/flush logic rather than an extraction, so the item
 * editor's own behaviour is untouched: typing marks dirty and arms a 5 s timer, ⌘S and
 * unmount flush immediately, and a save that lands while another is in flight is queued
 * behind it instead of racing it.
 */
export function useItemAutosave(itemId: number, initial: ItemDTO): ItemAutosave {
  const [item, setItem] = useState(initial);
  const [title, setTitleState] = useState(initial.title);
  const [body, setBodyState] = useState(initial.body);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ title: initial.title, body: initial.body });
  const titleTouched = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const pendingAgain = useRef(false);
  const dirtyCounter = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  /** Writes go one at a time, in the order they were asked for. */
  function enqueue(work: () => Promise<void>): Promise<void> {
    const next = chain.current.then(work, work);
    chain.current = next.catch(() => {});
    return next;
  }

  const persist = useCallback(
    (keepalive = false): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      if (inflight.current) {
        pendingAgain.current = true;
        return inflight.current;
      }
      const run = (async () => {
        const dirtyAtStart = dirtyCounter.current;
        const { title, body } = latest.current;
        setSave("saving");
        try {
          await enqueue(async () => {
            const res = await fetch(`/api/items/${itemId}`, {
              method: "PATCH",
              keepalive,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title, body }),
            });
            if (!res.ok) throw new Error(res.statusText);
            setItem((await res.json()) as ItemDTO);
          });
          const stillDirty = dirtyCounter.current !== dirtyAtStart || pendingAgain.current;
          setSave(stillDirty ? "dirty" : "saved");
        } catch {
          setSave("error");
        } finally {
          inflight.current = null;
          if (pendingAgain.current) {
            pendingAgain.current = false;
            void persist();
          }
        }
      })();
      inflight.current = run;
      return run;
    },
    [itemId],
  );

  function markDirty() {
    dirtyCounter.current += 1;
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }

  function setTitle(next: string) {
    titleTouched.current = true;
    latest.current = { ...latest.current, title: next };
    setTitleState(next);
    markDirty();
  }

  function setBody(next: string) {
    latest.current = { ...latest.current, body: next };
    setBodyState(next);
    markDirty();
  }

  /** A poll's answer never overwrites what is being typed: only an untouched title follows. */
  const syncFromServer = useCallback((next: ItemDTO) => {
    setItem(next);
    if (!titleTouched.current) {
      latest.current = { ...latest.current, title: next.title };
      setTitleState(next.title);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void persist(true);
      }
    };
  }, [persist]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persist();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persist]);

  return { item, title, body, save, saveLabel: SAVE_LABEL[save], setTitle, setBody, persist, syncFromServer };
}
