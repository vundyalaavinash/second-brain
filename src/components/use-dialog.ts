"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Everything inside a panel that the keyboard can land on. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  /** Closes the dialog. Escape calls it.  */
  onClose: () => void;
  /**
   * False while a write is in flight. Without it Escape reads as "cancel" to the person and
   * goes through as "the request already left" to the server, which on a delete means the
   * goal is gone and the last thing they did was press the key that means stop.
   */
  canClose?: boolean;
}

/**
 * The three things `aria-modal="true"` promises that a bare `fixed inset-0` div does not keep:
 * focus starts inside the panel, Tab cycles within it instead of walking into the page behind,
 * and Escape closes. Returning focus to the control that opened the dialog stays with the
 * caller — it is the only place that knows what that control was.
 */
export function useDialog({ onClose, canClose = true }: Options): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement>(null);
  // The key handler lives for the dialog's whole life. Reading the flag off a ref keeps it
  // from being torn down and rebuilt every time a request starts or finishes.
  const closable = useRef(canClose);
  useEffect(() => {
    closable.current = canClose;
  }, [canClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (closable.current) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      // Tab off either end wraps round to the other, and focus that has somehow left the panel
      // is pulled back — the part of being modal that markup alone cannot claim.
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return panelRef;
}
