"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { IconButton } from "../ui";

interface Toast { id: number; text: string; href?: string; hrefLabel?: string; action?: { label: string; onClick(): void } }

const Ctx = createContext<{ push(t: Omit<Toast, "id">): void } | null>(null);

const TOAST_MS = 5000;
/** A toast offering something to do is worth reading twice and reaching for: it stays four
 * times as long, and the keyboard can take its action without hunting for the button. */
const ACTION_TOAST_MS = 20_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // One dismissal timer per toast, by id. They outlive the toast that scheduled them by up to
  // twenty seconds, so unmounting the provider has to cancel them rather than leave them to
  // fire setState on a gone tree, and a toast dismissed by hand cancels its own.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    const timer = setTimeout(() => {
      timers.current.delete(id);
      setToasts((list) => list.filter((x) => x.id !== id));
    }, t.action ? ACTION_TOAST_MS : TOAST_MS);
    timers.current.set(id, timer);
  }, []);
  // Anything in the app can raise a toast without reaching for the context: the planner's rows
  // and the palette both fire this event from handlers that have no provider above them. A
  // detail may carry one action — "Place tomorrow" after a place that left time over — whose
  // handler belongs to whatever raised the event, not to the provider.
  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<{ text?: string; action?: { label: string; onClick(): void } }>).detail;
      if (detail?.text) push({ text: detail.text, action: detail.action });
    }
    window.addEventListener("sb:toast", onToast);
    return () => window.removeEventListener("sb:toast", onToast);
  }, [push]);
  // The newest toast answers to the keyboard from wherever the work is being done: ⌘. takes its
  // action, Escape puts it away. Nothing is focused by a toast, so without this the action would
  // be a mouse-only offer.
  useEffect(() => {
    const latest = toasts[toasts.length - 1];
    if (!latest) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dismiss(latest.id);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "." && latest.action) {
        e.preventDefault();
        latest.action.onClick();
        dismiss(latest.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toasts, dismiss]);
  useEffect(() => {
    const scheduled = timers;
    return () => {
      for (const timer of scheduled.current.values()) clearTimeout(timer);
      scheduled.current.clear();
    };
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* The live region is mounted for the session and the toasts arrive inside it: a region
        * inserted alongside its own words is often never announced at all. Its buttons are
        * read with the words, which is the price of the announcement working. */}
      <div role="status" aria-live="polite" className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div key={t.id} className="panel rounded-md pl-3.5 pr-1.5 h-10 flex items-center gap-3 text-[13px]">
            <span>{t.text}</span>
            {t.href && (
              <Link href={t.href} className="focus-ring text-violet-bright rounded-sm">
                {t.hrefLabel ?? "Open"}
              </Link>
            )}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="focus-ring text-violet-bright rounded-sm"
              >
                {t.action.label}
              </button>
            )}
            <IconButton label="Dismiss" icon={X} onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
