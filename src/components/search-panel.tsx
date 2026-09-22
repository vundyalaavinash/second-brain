"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Archive, Search } from "lucide-react";
import type { ContainerDTO, SearchResultDTO } from "@/lib/dto";
import { ITEM_TYPES } from "@/db/enums";
import { relativeTime } from "@/lib/format";
import { Chip, EmptyState, Input, Kbd, PageHeader, Select } from "./ui";
import { KindIcon, KIND_LABEL, StatusDot, TypeIcon, TYPE_LABEL } from "./type-icon";

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
          <mark key={i} className="bg-violet-dim text-fg rounded-[3px] px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

interface Props {
  initialQuery?: string;
  initialTag?: string;
}

export function SearchPanel({ initialQuery = "", initialTag = "" }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState("");
  const [tag, setTag] = useState(initialTag);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [container, setContainer] = useState("");
  const [archived, setArchived] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [containers, setContainers] = useState<ContainerDTO[]>([]);
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
    let cancelled = false;
    fetch("/api/containers?status=active")
      .then((r) => (r.ok ? r.json() : []))
      .then((c: ContainerDTO[]) => {
        if (!cancelled) setContainers(c);
      })
      .catch(() => {
        if (!cancelled) setContainers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!q.trim() && !tag) {
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
        if (container) p.set("container", container);
        if (archived) p.set("archived", "1");
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
  }, [q, type, tag, from, to, container, archived]);

  const active = q.trim().length > 0 || Boolean(tag);
  const visible = active ? results : [];
  const status = useMemo(() => {
    if (loading) return "Searching";
    if (!active) return "Type to search by keyword or meaning";
    return `${visible.length} result${visible.length === 1 ? "" : "s"}`;
  }, [loading, active, visible.length]);

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-4">
      <PageHeader title="Search" meta={status} />

      <div className="flex items-center gap-3 h-12 px-4 rounded-lg border border-hairline bg-layer-1 focus-within:border-hairline-strong transition-colors duration-150">
        <Search className="w-4 h-4 text-fg-faint" />
        <input
          ref={inputRef}
          id="search-input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything, by keyword or meaning"
          className="flex-1 bg-transparent outline-none text-[15px]"
        />
        {loading && <span className="w-1.5 h-1.5 rounded-full bg-violet live-dot" />}
        <Kbd>/</Kbd>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Select value={type} onChange={(e) => setType(e.target.value)} size="sm" className="w-full">
            <option value="">Any type</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={tag} onChange={(e) => setTag(e.target.value)} size="sm" className="w-full">
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} size="sm" className="w-full" />
        </div>
        <span className="text-[12px] text-fg-faint">to</span>
        <div className="w-36">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} size="sm" className="w-full" />
        </div>
        <div className="w-56">
          <Select value={container} onChange={(e) => setContainer(e.target.value)} size="sm" className="w-full">
            <option value="">Any home</option>
            <option value="inbox">Inbox</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({KIND_LABEL[c.kind]})
              </option>
            ))}
          </Select>
        </div>
        <Chip icon={Archive} active={archived} aria-pressed={archived} onClick={() => setArchived((a) => !a)}>
          Include archived
        </Chip>
      </div>

      {visible.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => (
            <li
              key={r.item.id}
              className="pane px-4 py-3 hover:border-hairline-strong transition-colors duration-150"
            >
              <div className="flex items-center gap-3">
                <TypeIcon type={r.item.type} />
                <Link href={`/items/${r.item.id}`} className="flex-1 truncate text-[13.5px] font-medium hover:text-violet-bright">
                  {r.item.title}
                </Link>
                <StatusDot status={r.item.status} error={r.item.error} />
                <span className="font-mono text-[11px] text-fg-faint">{relativeTime(r.item.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
                <Highlight text={r.snippet} query={q} />
              </p>
              {(r.item.container || r.item.tags.length > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-fg-faint">
                  {r.item.container && (
                    <span className="inline-flex items-center gap-1">
                      <KindIcon kind={r.item.container.kind} className="w-3.5 h-3.5 text-fg-faint" />
                      {r.item.container.name}
                    </span>
                  )}
                  {r.item.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {active && !loading && visible.length === 0 && (
        <EmptyState icon={Search} text="No matches. Try fewer words or a different filter." />
      )}
    </div>
  );
}
