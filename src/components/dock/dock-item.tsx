"use client";

import { useState, type Ref } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Icon as Glyph } from "@phosphor-icons/react";
import { Kbd } from "../ui";

/** The magnification spring; the same one the whole row rides. */
const SPRING = { type: "spring" as const, stiffness: 400, damping: 28 };
const BOX = "focus-ring relative inline-flex items-center justify-center transition-colors duration-150";

export interface DockItemProps {
  label: string;
  icon: Glyph;
  /** A link when given, a button otherwise (Search, Capture, More). */
  href?: string;
  shortcut?: string;
  active?: boolean;
  /** Unread count drawn as a pip; anything over 99 reads as `99+`. */
  badge?: number;
  /** The danger pip: the recorder is not running. */
  dot?: boolean;
  title?: string;
  expanded?: boolean;
  /** Capture: a raised violet circle rather than a flat square. */
  raised?: boolean;
  scale?: number;
  onClick?: () => void;
  ref?: Ref<HTMLElement>;
}

/**
 * One dock icon, with its hover tooltip, its active caption, and its badges. The scale comes
 * from the dock so that one pointer listener drives the whole row.
 */
export function DockItem({
  label,
  icon: Icon,
  href,
  shortcut,
  active = false,
  badge,
  dot = false,
  title,
  expanded,
  raised = false,
  scale = 1,
  onClick,
  ref,
}: DockItemProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The caption already names the open view, so its tooltip would only repeat it.
  const tip = !active && (hovered || focused);
  const ariaLabel = [label, badge ? `${badge} waiting` : null, dot ? "not recording" : null].filter(Boolean).join(", ");
  const look = raised
    ? "w-12 h-12 rounded-full -translate-y-2 bg-violet text-on-violet shadow-[0_10px_24px_-8px_var(--color-violet)]"
    : `w-11 h-11 rounded-2xl ${active ? "text-violet-bright" : "text-fg-muted hover:text-fg"}`;

  /** A click focuses without `:focus-visible`, and then the hover already shows the tooltip. */
  function isKeyboard(el: HTMLElement): boolean {
    try {
      return el.matches(":focus-visible");
    } catch {
      return true;
    }
  }

  const glyph = (
    <>
      <Icon size={raised ? 24 : 22} weight={raised ? "bold" : "duotone"} aria-hidden />
      {badge ? (
        <motion.span
          key={badge}
          initial={{ scale: 1 }}
          animate={reduce ? { scale: 1 } : { scale: [1, 1.25, 1] }}
          transition={{ duration: 0.25 }}
          className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-violet text-on-violet font-mono text-[10px] leading-4 text-center"
        >
          {badge > 99 ? "99+" : badge}
        </motion.span>
      ) : null}
      {dot && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />}
    </>
  );

  return (
    <div
      className="relative flex items-end"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(e) => setFocused(isKeyboard(e.target as HTMLElement))}
      onBlur={() => setFocused(false)}
    >
      <motion.div
        animate={{ scale: reduce ? 1 : scale }}
        whileTap={reduce ? undefined : { scale: 0.9 }}
        transition={SPRING}
        className="origin-bottom"
      >
        {href ? (
          <Link
            ref={ref as Ref<HTMLAnchorElement>}
            href={href}
            aria-label={ariaLabel}
            aria-current={active ? "page" : undefined}
            title={title}
            onClick={onClick}
            data-dock-item
            className={`${BOX} ${look}`}
          >
            {glyph}
          </Link>
        ) : (
          <button
            ref={ref as Ref<HTMLButtonElement>}
            type="button"
            aria-label={ariaLabel}
            aria-expanded={expanded}
            title={title}
            onClick={onClick}
            data-dock-item
            className={`${BOX} ${look}`}
          >
            {glyph}
          </button>
        )}
      </motion.div>

      {/* Positioning stays on the plain wrappers: motion writes `transform`, which would
        * otherwise drop the centring translate. */}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3">
        {tip && (
          <motion.span
            role="tooltip"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.12 }}
            className="panel rounded-md px-2.5 py-1 text-[12px] flex items-center gap-1.5 whitespace-nowrap"
          >
            {label}
            {shortcut && <Kbd>{shortcut}</Kbd>}
          </motion.span>
        )}
      </span>

      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2">
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: reduce ? 0 : 0.15 }}
              className="block text-[12px] leading-4 text-violet-bright whitespace-nowrap"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
