"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

interface Toast { id: number; text: string; href?: string; hrefLabel?: string; action?: { label: string; onClick(): void } }

const Ctx = createContext<{ push(t: Omit<Toast, "id">): void } | null>(null);

const TOAST_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // One dismissal timer per toast. They outlive the toast that scheduled them by up to five
  // seconds, so unmounting the provider has to cancel them rather than leave them to fire
  // setState on a gone tree.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== timer);
      setToasts((list) => list.filter((x) => x.id !== id));
    }, TOAST_MS);
    timers.current.push(timer);
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
  useEffect(() => {
    const scheduled = timers;
    return () => {
      for (const timer of scheduled.current) clearTimeout(timer);
      scheduled.current = [];
    };
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 items-end" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="panel rounded-md px-3.5 h-10 flex items-center gap-3 text-[13px]">
            <span>{t.text}</span>
            {t.href && (
              <Link href={t.href} className="focus-ring text-violet-bright rounded-sm">
                {t.hrefLabel ?? "Open"}
              </Link>
            )}
            {t.action && (
              <button type="button" onClick={t.action.onClick} className="focus-ring text-violet-bright rounded-sm">
                {t.action.label}
              </button>
            )}
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
