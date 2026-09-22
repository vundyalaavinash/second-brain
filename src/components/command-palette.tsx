"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM, type IconName } from "./nav";
import { Icon } from "./icons";
import { Kbd } from "./ui";

interface Command {
  id: string;
  label: string;
  hint?: string;
  iconName?: IconName;
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
      [...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM].map((n) => ({
        id: n.href,
        label: n.label,
        hint: n.shortcut,
        iconName: n.icon,
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
    function onOpen() {
      setOpen(true);
      setQuery("");
      setIndex(0);
    }
    window.addEventListener("sb:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sb:palette", onOpen);
    };
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[16vh]" onClick={() => setOpen(false)}>
      <div className="panel w-[560px] max-w-[92vw] rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 h-12 px-4 border-b border-hairline focus-within:border-hairline-strong">
          <Search className="w-4 h-4 text-fg-faint" aria-hidden />
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
            placeholder="Jump to a view or run a command"
            className="flex-1 bg-transparent outline-none text-[14px]"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 && <li className="px-4 py-3 text-[13px] text-fg-faint">No matching commands.</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(c)}
              className={`mx-1.5 px-2.5 h-10 rounded-md flex items-center gap-3 cursor-pointer ${i === index ? "bg-layer-2 text-fg" : "text-fg-muted"}`}
            >
              {c.iconName && <Icon name={c.iconName} className="w-4 h-4" />}
              <span className="flex-1">{c.label}</span>
              {c.hint && <Kbd>{c.hint}</Kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
