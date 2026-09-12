"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav";
import { Icon } from "./icons";

const POLL_MS = 20_000;

export function Dock() {
  const pathname = usePathname();
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox?limit=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setInboxCount(data.count);
      } catch {
        /* offline */
      }
    }
    void load();
    const id = setInterval(load, POLL_MS);
    window.addEventListener("sb:inbox-changed", load);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("sb:inbox-changed", load);
    };
  }, [pathname]);

  return (
    <nav aria-label="Main" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <ul className="flex items-center gap-0.5 px-2 py-1.5 rounded-2xl bg-surface-2/90 backdrop-blur-md border border-line-strong shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.badge === "inbox" ? inboxCount : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={item.label}
                className={`group relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-150 hover:-translate-y-0.5 ${
                  active ? "text-accent bg-accent-dim" : "text-fg-muted hover:text-fg hover:bg-surface-3"
                }`}
              >
                <Icon name={item.icon} />
                {count > 0 && (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-bg font-mono text-[10px] leading-4 text-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-[11px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0">
                  {item.label} <span className="kbd ml-1">{item.shortcut}</span>
                </span>
              </Link>
            </li>
          );
        })}
        <li className="w-px h-6 bg-line mx-1" aria-hidden />
        <li>
          <button
            type="button"
            aria-label="Command palette"
            onClick={() => window.dispatchEvent(new Event("sb:palette"))}
            className="group relative flex items-center justify-center h-11 px-2 rounded-xl font-mono text-[11px] text-fg-faint hover:text-fg hover:bg-surface-3 transition-colors duration-150"
          >
            ⌘K
          </button>
        </li>
      </ul>
    </nav>
  );
}
