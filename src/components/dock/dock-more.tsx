"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import type { NavItem } from "../nav";
import { Icon } from "../icons";

/** Overflow entry for the narrow dock: a button that toggles a panel sheet above the dock
 * listing the nav items that do not fit in the compact row. */
export function DockMore({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <li className="relative">
      <button
        type="button"
        aria-label="More destinations"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center justify-center w-11 h-11 rounded-full text-fg-muted hover:text-fg hover:bg-slate-2 transition-colors duration-150"
      >
        <MoreHorizontal className="w-5 h-5" strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <ul className="panel absolute -top-2 right-0 -translate-y-full w-48 rounded-lg py-1.5">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`focus-ring hairline-row flex items-center gap-3 px-3 h-11 transition-colors ${active ? "text-brass" : "text-fg-muted hover:text-fg hover:bg-slate-2"}`}
                >
                  <Icon name={item.icon} className="w-4 h-4" />
                  <span className="flex-1 text-[13px]">{item.label}</span>
                  <span className="kbd">{item.shortcut}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
