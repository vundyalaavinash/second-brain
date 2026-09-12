"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ItemDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";
import { StatusBadge, TypeBadge } from "./badges";
import { relativeTime } from "@/lib/format";
import { ContainerPicker } from "./container-picker";

type Mode = "focus" | "list";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function InboxProcessor() {
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("focus");
  const [picker, setPicker] = useState<ContainerKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox", { cache: "no-store" });
        if (!res.ok) throw new Error(res.statusText);
        const data = (await res.json()) as { count: number; items: ItemDTO[] };
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.count);
        setIndex((i) => Math.min(i, Math.max(0, data.items.length - 1)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = items[index];

  function removeCurrent() {
    setItems((all) => all.filter((_, i) => i !== index));
    setTotal((t) => Math.max(0, t - 1));
    setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    setConfirmDelete(false);
  }

  async function patch(body: Record<string, unknown>) {
    if (!current) return;
    setError(null);
    const res = await fetch(`/api/items/${current.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      return;
    }
    removeCurrent();
  }

  async function remove() {
    if (!current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/items/${current.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Delete failed");
      return;
    }
    removeCurrent();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (picker || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "p":
        case "a":
        case "r":
          if (!current) return;
          e.preventDefault();
          setPicker(e.key === "p" ? "project" : e.key === "a" ? "area" : "resource");
          break;
        case "e":
          e.preventDefault();
          void patch({ archived: true });
          break;
        case "x":
          e.preventDefault();
          void remove();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, items.length - 1));
          setConfirmDelete(false);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          setConfirmDelete(false);
          break;
        case "l":
          e.preventDefault();
          setMode((m) => (m === "focus" ? "list" : "focus"));
          break;
        case "Escape":
          setConfirmDelete(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, current, items.length, confirmDelete]);

  const preview = current ? (current.body || current.extractedText).replace(/\s+/g, " ").trim().slice(0, 600) : "";

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Inbox</h1>
        <span className="font-mono text-[10px] text-fg-faint">
          {loaded ? (items.length ? `${index + 1} of ${total}` : "inbox zero") : "loading"} · <button onClick={() => setMode((m) => (m === "focus" ? "list" : "focus"))} className="hover:text-fg">{mode === "focus" ? "list (l)" : "focus (l)"}</button>
        </span>
      </header>

      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}

      {loaded && items.length === 0 && (
        <div className="rounded-lg border border-line bg-surface-1 p-8 text-center">
          <div className="text-fg">Nothing waiting.</div>
          <Link href="/capture" className="mt-2 inline-block text-[12px] text-accent hover:underline">
            Capture something
          </Link>
        </div>
      )}

      {mode === "list" && items.length > 0 && (
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.map((item, i) => (
            <li
              key={item.id}
              onClick={() => {
                setIndex(i);
                setMode("focus");
              }}
              className={`flex items-center gap-3 px-3 h-9 cursor-pointer ${i === index ? "bg-surface-3" : "hover:bg-surface-2"}`}
            >
              <TypeBadge type={item.type} />
              <span className="flex-1 truncate text-[13px]">{item.title}</span>
              <span className="font-mono text-[10px] text-fg-faint">{relativeTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {mode === "focus" && current && (
        <section className="rounded-lg border border-line bg-surface-1">
          <div className="flex items-center gap-3 px-4 h-10 border-b border-line">
            <TypeBadge type={current.type} />
            <Link href={`/items/${current.id}`} className="flex-1 truncate text-[13.5px] font-medium hover:text-accent">
              {current.title}
            </Link>
            <StatusBadge status={current.status} error={current.error} />
            <span className="font-mono text-[10px] text-fg-faint">{relativeTime(current.createdAt)}</span>
          </div>
          <div className="px-4 py-3 text-[13px] leading-relaxed text-fg-muted min-h-24">
            {current.sourceUrl && (
              <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="block font-mono text-[11px] text-accent truncate mb-2">
                {current.sourceUrl}
              </a>
            )}
            {preview || <span className="text-fg-faint">No text yet.</span>}
          </div>
          {(current.tags.length > 0 || current.people.length > 0) && (
            <div className="px-4 pb-3 flex flex-wrap gap-2 font-mono text-[10px] text-fg-faint">
              {current.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {current.people.map((p) => (
                <span key={p.id}>@{p.slug}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 h-12 border-t border-line">
            {(
              [
                ["p", "Project", () => setPicker("project")],
                ["a", "Area", () => setPicker("area")],
                ["r", "Resource", () => setPicker("resource")],
                ["e", "Archive", () => void patch({ archived: true })],
              ] as const
            ).map(([key, label, run]) => (
              <button key={key} onClick={run} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong flex items-center gap-2">
                <span className="kbd">{key}</span>
                {label}
              </button>
            ))}
            <button
              onClick={() => void remove()}
              className={`h-7 px-2 rounded-md text-[12px] border flex items-center gap-2 ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}
            >
              <span className="kbd">x</span>
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
            <span className="flex-1" />
            <span className="font-mono text-[10px] text-fg-faint">j / k to move</span>
          </div>
        </section>
      )}

      {picker && (
        <ContainerPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onPick={(c) => {
            setPicker(null);
            void patch({ containerId: c ? c.id : null });
          }}
        />
      )}
    </div>
  );
}
