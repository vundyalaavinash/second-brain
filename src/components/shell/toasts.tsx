"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

interface Toast { id: number; text: string; href?: string; hrefLabel?: string; action?: { label: string; onClick(): void } }

const Ctx = createContext<{ push(t: Omit<Toast, "id">): void } | null>(null);

const TOAST_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), TOAST_MS);
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
