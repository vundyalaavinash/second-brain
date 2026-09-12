"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResultDTO } from "@/lib/dto";
import { ITEM_TYPES } from "@/db/enums";
import { relativeTime } from "@/lib/format";
import { StatusBadge, TypeBadge } from "./badges";

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
  if (terms.length === 0) return <>{text}</>;
  const pattern = `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
  const splitter = new RegExp(pattern, "gi");
  const matcher = new RegExp(pattern, "i");
  return (
    <>
      {text.split(splitter).map((part, i) =>
        matcher.test(part) ? (
          <mark key={i} className="bg-accent-dim text-fg rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchPanel() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResultDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : []))
      .then((t: string[]) => {
        if (!cancelled) setTags(t);
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ q });
        if (type) p.set("type", type);
        if (tag) p.set("tag", tag);
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        const res = await fetch(`/api/search?${p.toString()}`, { signal: ctrl.signal });
        if (res.ok) setResults((await res.json()) as SearchResultDTO[]);
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, type, tag, from, to]);

  const select = "h-7 bg-surface-2 border border-line rounded-sm px-2 font-mono text-[11px] text-fg-muted outline-none";
  const visible = q.trim() ? results : [];
  const status = useMemo(() => {
    if (loading) return "searching";
    if (!q.trim()) return "type to search";
    return `${visible.length} result${visible.length === 1 ? "" : "s"}`;
  }, [loading, q, visible.length]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Search</h1>
        <span className="font-mono text-[10px] text-fg-faint">{status}</span>
      </header>

      <div className="flex items-center gap-2 h-11 px-4 rounded-lg border border-line bg-surface-1 focus-within:border-accent transition-colors duration-150">
        <span className="font-mono text-fg-faint">/</span>
        <input
          ref={inputRef}
          id="search-input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything, by keyword or meaning"
          className="flex-1 bg-transparent outline-none"
        />
        {loading && <span className="w-1.5 h-1.5 rounded-full bg-accent live-dot" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={select}>
          <option value="">any type</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} className={select}>
          <option value="">any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={select} />
        <span className="font-mono text-[10px] text-fg-faint">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={select} />
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((r) => (
          <li key={r.item.id} className="rounded-lg border border-line bg-surface-1 px-4 py-3 hover:border-line-strong transition-colors duration-150">
            <div className="flex items-center gap-3">
              <TypeBadge type={r.item.type} />
              <Link href={`/items/${r.item.id}`} className="flex-1 truncate text-[13.5px] font-medium hover:text-accent">
                {r.item.title}
              </Link>
              <StatusBadge status={r.item.status} />
              <span className="font-mono text-[10px] text-fg-faint">{relativeTime(r.item.createdAt)}</span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-fg-muted leading-relaxed">
              <Highlight text={r.snippet} query={q} />
            </p>
            {r.item.tags.length > 0 && (
              <div className="mt-1.5 flex gap-2">
                {r.item.tags.map((t) => (
                  <span key={t} className="font-mono text-[10px] text-fg-faint">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
