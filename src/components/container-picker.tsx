"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContainerDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";

interface Props {
  kind?: ContainerKind;
  allowInbox?: boolean;
  title?: string;
  onPick: (container: ContainerDTO | null) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<ContainerKind, string> = { project: "Project", area: "Area", resource: "Resource" };

export function ContainerPicker({ kind, allowInbox = false, title, onPick, onClose }: Props) {
  const [all, setAll] = useState<ContainerDTO[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/containers?status=active")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ContainerDTO[]) => {
        if (!cancelled) setAll(list);
      })
      .catch(() => {});
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const options = useMemo(() => {
    const pool = kind ? all.filter((c) => c.kind === kind) : all;
    return q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  }, [all, kind, q]);
  const exact = options.some((c) => c.name.toLowerCase() === q);
  const canCreate = Boolean(kind && q && !exact);
  const rows: Array<{ key: string; label: string; hint: string; run: () => void }> = [];
  if (allowInbox && !q) rows.push({ key: "inbox", label: "Inbox", hint: "unfiled", run: () => onPick(null) });
  for (const c of options) rows.push({ key: String(c.id), label: c.name, hint: KIND_LABEL[c.kind], run: () => onPick(c) });
  if (canCreate) rows.push({ key: "new", label: `Create ${KIND_LABEL[kind!].toLowerCase()} “${query.trim()}”`, hint: "new", run: () => void create() });

  async function create() {
    if (!kind || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: query.trim() }),
      });
      if (res.ok) onPick((await res.json()) as ContainerDTO);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[18vh]" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] bg-surface-2 border border-line-strong rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 h-8 flex items-center font-mono text-[10px] tracking-wider uppercase text-fg-faint border-b border-line">
          {title ?? (kind ? `File to ${KIND_LABEL[kind].toLowerCase()}` : "Move to")}
        </div>
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
              setIndex((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && rows[index]) {
              e.preventDefault();
              rows[index].run();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder={kind ? "Type to filter or create" : "Type to filter"}
          className="w-full h-11 px-4 bg-transparent border-b border-line outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {rows.length === 0 && <li className="px-4 py-2 text-fg-faint">Nothing here yet</li>}
          {rows.map((r, i) => (
            <li
              key={r.key}
              onMouseEnter={() => setIndex(i)}
              onClick={r.run}
              className={`px-4 h-9 flex items-center justify-between cursor-pointer ${i === index ? "bg-surface-3 text-fg" : "text-fg-muted"}`}
            >
              <span className="truncate">{r.label}</span>
              <span className="font-mono text-[10px] text-fg-faint">{r.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
