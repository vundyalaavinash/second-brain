"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command } from "lucide-react";
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
      <ul className="frost flex items-center gap-1 px-2 py-1.5 rounded-[14px]">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.badge === "inbox" ? inboxCount : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-label={count > 0 ? `${item.label}, ${count} waiting` : item.label}
                className={`focus-ring group relative flex items-center justify-center w-11 h-11 rounded-[10px] transition-all duration-150 motion-safe:hover:-translate-y-0.5 ${
                  active ? "text-accent" : "text-fg-muted hover:text-fg hover:bg-surface-3"
                }`}
              >
                <Icon name={item.icon} />
                {active && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" aria-hidden />}
                {count > 0 && (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-bg font-mono text-[10px] leading-4 text-center">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-[rgba(24,24,28,0.95)] px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0"
                >
                  {item.label}
                  <span className="kbd ml-2">{item.shortcut}</span>
                </span>
              </Link>
            </li>
          );
        })}
        <li className="w-px h-6 bg-line-strong mx-1" aria-hidden />
        <li>
          <button
            type="button"
            aria-label="Command palette"
            onClick={() => window.dispatchEvent(new Event("sb:palette"))}
            className="focus-ring group relative flex items-center justify-center w-11 h-11 rounded-[10px] text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors duration-150"
          >
            <Command className="w-5 h-5" strokeWidth={1.75} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-[rgba(24,24,28,0.95)] px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0"
            >
              Commands
              <span className="kbd ml-2">⌘K</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
