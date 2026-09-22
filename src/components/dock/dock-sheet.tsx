"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { Icon as Glyph } from "@phosphor-icons/react";
import type { IconName, NavItem } from "../nav";
import { Kbd } from "../ui";

/** The views the narrow pill has no room for, listed above it. */
export function DockSheet({
  items,
  icons,
  pathname,
  onClose,
  onNavigate,
}: {
  items: NavItem[];
  icons: Record<IconName, Glyph>;
  pathname: string;
  /** Escape or a dismiss: the sheet closes and hands focus back to the More button. */
  onClose(): void;
  /** A row was taken: the sheet closes and leaves focus to the page being navigated to. */
  onNavigate(): void;
}) {
  const reduce = useReducedMotion();
  const firstRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3">
      <motion.ul
        role="list"
        aria-label="More views"
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.15 }}
        className="panel rounded-lg list-none m-0 p-1.5 w-56 flex flex-col gap-0.5"
      >
        {items.map((item, i) => {
          const Icon = icons[item.icon];
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                ref={i === 0 ? firstRef : undefined}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={`focus-ring flex items-center gap-3 h-11 px-3 rounded-md text-[13px] ${
                  active ? "bg-layer-3 text-violet-bright" : "text-fg-muted hover:text-fg hover:bg-layer-2"
                }`}
              >
                <Icon size={20} weight="duotone" aria-hidden />
                <span className="flex-1 truncate">{item.label}</span>
                <Kbd>{item.shortcut}</Kbd>
              </Link>
            </li>
          );
        })}
      </motion.ul>
    </div>
  );
}
