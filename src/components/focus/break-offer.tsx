"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "../ui";
import type { FocusCompletedDetail } from "./use-focus";

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * One line, offered only right after a focus run finishes on its own — never a modal, and never
 * shown any other way: `sb:focus-completed` is dispatched from exactly one place, `useFocus`'s
 * own auto- and manual-finish, and only for outcome "completed". Taking the break starts a
 * plain countdown here, on this page alone; nothing records a break anywhere, so leaving the
 * page or dismissing the line loses nothing worth keeping.
 */
export function BreakOffer() {
  const [offer, setOffer] = useState<FocusCompletedDetail | null>(null);
  // The break's own end, or null before one is taken. `now` only exists to make the countdown
  // re-render; the target time is the one thing remembered.
  const [breakEndAt, setBreakEndAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    function onCompleted(e: Event) {
      setOffer((e as CustomEvent<FocusCompletedDetail>).detail);
      setBreakEndAt(null);
    }
    window.addEventListener("sb:focus-completed", onCompleted);
    return () => window.removeEventListener("sb:focus-completed", onCompleted);
  }, []);

  // Ticks while a break is running; the interval itself notices the break running out and
  // clears both pieces of state from inside its own callback, never synchronously in the effect
  // body.
  useEffect(() => {
    if (breakEndAt === null) return;
    const timer = setInterval(() => {
      if (Date.now() >= breakEndAt) {
        setOffer(null);
        setBreakEndAt(null);
      } else {
        setNow(Date.now());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [breakEndAt]);

  if (!offer) return null;

  const minutes = offer.completedToday > 0 && offer.completedToday % offer.settings.longBreakEvery === 0 ? offer.settings.longBreak : offer.settings.shortBreak;

  // Mounted once in the shell rather than any one page, so it floats free like the dock and the
  // toasts do — a fixed line, not something laid into whatever page happens to be showing.
  // Pinned above the dock rather than the top of the page: `top-4` sat over `TopBar`'s breadcrumb
  // trail at narrow widths. It follows `toasts.tsx`'s idiom for a transient line near the dock,
  // one row higher than the toast stack — both would otherwise sit at `bottom-24`, and on a phone
  // a centred pill and a right-aligned toast overlap there. The width is capped and the text is
  // allowed to wrap so the line can never push the page sideways at 400px.
  const shell =
    "fixed bottom-36 left-1/2 -translate-x-1/2 z-50 panel rounded-2xl min-h-10 py-1.5 px-4 flex items-center gap-2 text-[12.5px] text-fg-muted m-0 max-w-[calc(100vw-3rem)]";

  if (breakEndAt !== null) {
    return (
      <p className={shell}>
        <span>
          Back to it in <span className="font-mono tabular-nums">{clock(breakEndAt - now)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setOffer(null);
            setBreakEndAt(null);
          }}
          className="focus-ring rounded-sm text-fg-faint hover:text-fg underline"
        >
          Skip
        </button>
      </p>
    );
  }

  return (
    <p className={shell}>
      <span>Take {minutes} minutes?</span>
      <Button size="sm" variant="ghost" onClick={() => setBreakEndAt(Date.now() + minutes * 60_000)}>
        Take a break
      </Button>
      <IconButton label="Dismiss the break offer" icon={X} onClick={() => setOffer(null)} />
    </p>
  );
}
