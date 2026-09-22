"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Portals a page-supplied breadcrumb tail into the top bar. `parent` (optional) replaces the route-derived parent crumb. */
export function Crumb({ title, parent }: { title: string; parent?: { label: string; href: string } }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The portal target only exists in the DOM after mount, so it cannot be read
    // during render. Runs once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(document.getElementById("crumb-slot"));
  }, []);
  if (!slot) return null;
  return createPortal(
    <>
      {parent && (
        <>
          <a href={parent.href} className="focus-ring text-fg-muted hover:text-fg rounded-sm">
            {parent.label}
          </a>
          <span className="text-fg-faint">/</span>
        </>
      )}
      <span className="text-fg truncate">{title}</span>
    </>,
    slot,
  );
}
