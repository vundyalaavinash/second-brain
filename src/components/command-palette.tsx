"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS } from "./sidebar";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () =>
      NAV_ITEMS.filter((n) => n.enabled).map((n) => ({
        id: n.href,
        label: `Go to ${n.label}`,
        hint: n.shortcut,
        run: () => router.push(n.href),
      })),
    [router],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function choose(c: Command) {
    setOpen(false);
    c.run();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[18vh]" onClick={() => setOpen(false)}>
      <div
        className="w-[520px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[index]) {
              choose(filtered[index]);
            }
          }}
          placeholder="Type a command"
          className="w-full h-11 px-4 bg-transparent border-b border-line outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-2 text-fg-faint">No matches</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(c)}
              className={`px-4 h-9 flex items-center justify-between cursor-pointer ${i === index ? "bg-surface-3 text-fg" : "text-fg-muted"}`}
            >
              <span>{c.label}</span>
              {c.hint && <span className="kbd">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
