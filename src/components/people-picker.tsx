"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PersonDTO } from "@/lib/dto";

interface Props {
  selected: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}

export function PeoplePicker({ selected, onChange, onClose }: Props) {
  const [all, setAll] = useState<PersonDTO[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => selected);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/people")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PersonDTO[]) => {
        if (!cancelled) setAll(list);
      })
      .catch(() => {});
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const options = useMemo(() => (q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q)) : all), [all, q]);
  const exact = options.some((p) => p.name.toLowerCase() === q);

  function toggle(id: number) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    setSelectedIds(next);
    onChange(next);
  }

  async function create() {
    if (!q || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: query.trim() }) });
      if (res.ok) {
        const p = (await res.json()) as PersonDTO;
        setAll((a) => [...a, p]);
        const next = [...selectedIds, p.id];
        setSelectedIds(next);
        onChange(next);
        setQuery("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[18vh]" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 h-8 flex items-center font-mono text-[10px] tracking-wider uppercase text-fg-faint border-b border-line">People on this item</div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && q && !exact) {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="Filter, or type a new name and press Enter"
          className="w-full h-11 px-4 bg-transparent border-b border-line outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {options.map((p) => (
            <li key={p.id} onClick={() => toggle(p.id)} className="px-4 h-9 flex items-center justify-between cursor-pointer hover:bg-surface-3">
              <span className={selectedIds.includes(p.id) ? "text-fg" : "text-fg-muted"}>{p.name}</span>
              <span className="font-mono text-[10px] text-fg-faint">{selectedIds.includes(p.id) ? "✓ linked" : `@${p.slug}`}</span>
            </li>
          ))}
          {q && !exact && <li onClick={() => void create()} className="px-4 h-9 flex items-center cursor-pointer text-accent">Create “{query.trim()}”</li>}
          {options.length === 0 && !q && <li className="px-4 py-2 text-fg-faint">Nobody yet. Type a name.</li>}
        </ul>
        <div className="px-4 h-9 flex items-center justify-end border-t border-line">
          <button onClick={onClose} className="text-[12px] text-fg-muted hover:text-fg">Done</button>
        </div>
      </div>
    </div>
  );
}
