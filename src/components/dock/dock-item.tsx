"use client";
import Link from "next/link";
import type { ReactNode } from "react";

export function DockItem({
  href,
  label,
  shortcut,
  active,
  badge,
  dot,
  children,
}: {
  href: string;
  label: string;
  shortcut: string;
  active: boolean;
  badge?: number;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative">
      <Link
        href={href}
        aria-label={[label, badge ? `${badge} waiting` : null, dot ? "not recording" : null].filter(Boolean).join(", ")}
        aria-current={active ? "page" : undefined}
        className={`focus-ring group relative flex items-center justify-center w-11 h-11 rounded-full transition-colors duration-150 motion-safe:active:scale-95 ${
          active ? "text-brass" : "text-fg-muted hover:text-fg hover:bg-slate-2"
        }`}
      >
        {children}
        {badge ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-brass text-brass-ink font-mono text-[10px] leading-4 text-center">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {dot && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />}
        <span
          role="tooltip"
          className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap panel rounded-md px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0"
        >
          {label}
          <span className="kbd ml-2">{shortcut}</span>
        </span>
      </Link>
      {active && (
        <span className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-[12px] text-brass whitespace-nowrap motion-safe:animate-[fade-in_150ms_ease-out]">
          {label}
        </span>
      )}
    </li>
  );
}
