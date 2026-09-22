"use client";
import { createPortal } from "react-dom";
import { useSlot } from "./use-slot";

/**
 * Portals a page-supplied breadcrumb tail into the top bar, after the route trail the bar
 * renders itself. `parent` (optional) stands in front of the title in place of that trail.
 */
export function Crumb({ title, parent }: { title: string; parent?: { label: string; href: string } }) {
  const slot = useSlot("crumb-slot");
  if (!slot) return null;
  return createPortal(
    <>
      {parent ? (
        <>
          <a href={parent.href} className="crumb-parent focus-ring text-fg-muted hover:text-fg rounded-sm">
            {parent.label}
          </a>
          <span className="text-fg-faint">/</span>
        </>
      ) : (
        // Separates the title from the trail before the slot; `.crumb-trail:empty` drops it
        // when the route has no parent, so a lone title never leads with a slash.
        <span className="crumb-sep text-fg-faint">/</span>
      )}
      <span className="text-fg truncate">{title}</span>
    </>,
    slot,
  );
}
