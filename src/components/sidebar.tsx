"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  enabled: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", shortcut: "g t", enabled: false },
  { href: "/capture", label: "Capture", shortcut: "g c", enabled: true },
  { href: "/library", label: "Library", shortcut: "g l", enabled: true },
  { href: "/search", label: "Search", shortcut: "g s", enabled: true },
  { href: "/chat", label: "Chat", shortcut: "g a", enabled: false },
  { href: "/journal", label: "Journal", shortcut: "g j", enabled: false },
  { href: "/review", label: "Review", shortcut: "g r", enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-line bg-surface-1 flex flex-col">
      <div className="h-12 flex items-center px-4 border-b border-line">
        <span className="w-2 h-2 rounded-full bg-accent mr-2" />
        <span className="font-medium tracking-tight">Second Brain</span>
      </div>
      <nav className="flex-1 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const base = "flex items-center justify-between px-4 h-8 text-[13px] transition-colors duration-150";
          if (!item.enabled) {
            return (
              <div key={item.href} className={`${base} text-fg-faint cursor-default`} aria-disabled>
                <span>{item.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider">soon</span>
              </div>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${base} ${active ? "text-fg bg-surface-3 border-l-2 border-accent pl-[14px]" : "text-fg-muted hover:text-fg hover:bg-surface-2"}`}
            >
              <span>{item.label}</span>
              <span className="kbd">{item.shortcut}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-line text-[11px] text-fg-faint font-mono flex items-center justify-between">
        <span>localhost:3141</span>
        <span className="kbd">⌘K</span>
      </div>
    </aside>
  );
}
