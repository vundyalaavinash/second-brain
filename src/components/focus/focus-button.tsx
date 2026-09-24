"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Square, Timer } from "lucide-react";
import { Button, IconButton } from "../ui";
import { useFocus, type StartFocusInput } from "./use-focus";

/** The alternates the small menu offers, beside whatever length the button would otherwise
 * start with. */
const ALT_MINUTES = [25, 50];

interface Props {
  task: { id: number; title: string };
  /** The session this run belongs to. Its own length is used unless a preset overrides it —
   * never recomputed here from the block's own minutes, which the server already knows. */
  blockId?: number;
  /** An explicit length, for a caller that already knows one. Left out everywhere else so the
   * saved default (or the block's own length) applies. */
  minutes?: number;
  /** Offers 25 and 50 as alternate lengths behind a small caret menu. Only where there is room
   * beside the plain button — a packed row does not get one. */
  menu?: boolean;
  /** Icon only, for a spot too tight for the label — a session's own block on the timeline. */
  compact?: boolean;
  className?: string;
}

/**
 * The one control every surface starts a focus run from: task rows, plan rows, and sessions on
 * the timeline. `useFocus` owns the run; this only starts and stops it, reading from the same
 * hook everywhere so every button on screen agrees about which task is running.
 */
export function FocusButton({ task, blockId, minutes, menu = false, compact = false, className = "" }: Props) {
  const { run, start, finish, busy } = useFocus();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

  const live = !!run && run.taskId === task.id && (blockId === undefined || run.blockId === blockId);

  useEffect(() => {
    if (!menuOpen) return;
    function close() {
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      close();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  function begin(explicitMinutes?: number) {
    setMenuOpen(false);
    const input: StartFocusInput = { taskId: task.id, blockId, minutes: explicitMinutes ?? minutes };
    start(input);
  }

  if (live) {
    return compact ? (
      <IconButton label={`Stop focusing on ${task.title}`} icon={Square} disabled={busy} onClick={() => finish("stopped")} className={`shrink-0 ${className}`} />
    ) : (
      <Button
        variant="secondary"
        size="sm"
        icon={Square}
        disabled={busy}
        onClick={() => finish("stopped")}
        aria-label={`Stop focusing on ${task.title}`}
        className={`shrink-0 ${className}`}
      >
        Stop
      </Button>
    );
  }

  if (compact) {
    return (
      <IconButton label={`Focus on ${task.title}`} icon={Timer} disabled={busy} onClick={() => begin()} className={`shrink-0 ${className}`} />
    );
  }

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <Button
        variant="secondary"
        size="sm"
        icon={Timer}
        disabled={busy}
        onClick={() => begin()}
        className={menu ? "rounded-r-none" : ""}
        aria-label={`Focus on ${task.title}`}
      >
        Focus
      </Button>
      {menu && (
        <>
          <button
            ref={menuButtonRef}
            type="button"
            disabled={busy}
            aria-label="Other lengths"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="focus-ring inline-flex items-center justify-center w-6 h-7 rounded-r-sm border border-l-0 border-hairline bg-layer-1 hover:border-hairline-strong transition-colors disabled:opacity-40"
          >
            <ChevronDown className="w-3 h-3" aria-hidden />
          </button>
          {menuOpen && (
            <div
              ref={menuPanelRef}
              role="menu"
              aria-label="Focus for"
              className="panel absolute right-0 top-full mt-1 rounded-md p-1 flex flex-col gap-0.5 w-28 z-50"
            >
              {ALT_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  onClick={() => begin(m)}
                  className="focus-ring w-full flex items-center px-2 h-8 rounded-sm text-left text-[12.5px] text-fg-muted hover:text-fg hover:bg-layer-2 transition-colors duration-100"
                >
                  {m} minutes
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </span>
  );
}
