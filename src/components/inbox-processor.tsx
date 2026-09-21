"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ItemDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";
import { Inbox as InboxIcon, Archive, Trash2, Flag, Layers, BookMarked, List as ListIcon, Focus, ExternalLink } from "lucide-react";
import { Button, Kbd, PageHeader, EmptyState, List, Row } from "./ui";
import { TypeIcon, StatusDot } from "./type-icon";
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
  const busy = useRef(false);
  const [busyState, setBusyState] = useState(false);
  const refetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox?limit=500", { cache: "no-store" });
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

  // Inbox count and the loaded page can disagree (e.g. a fetch raced a change); refetch once rather
  // than claim "inbox zero" while the server still reports items outstanding.
  useEffect(() => {
    if (!loaded || items.length !== 0 || total <= 0 || refetchedRef.current) return;
    refetchedRef.current = true;
    let cancelled = false;
    async function reload() {
      try {
        const res = await fetch("/api/inbox?limit=500", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number; items: ItemDTO[] };
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.count);
        setIndex((i) => Math.min(i, Math.max(0, data.items.length - 1)));
      } catch {
        /* leave state as-is; the initial load already surfaced any error */
      }
    }
    void reload();
    return () => {
      cancelled = true;
    };
  }, [loaded, items.length, total]);

  const current = items[index];

  function openPicker(kind: ContainerKind) {
    setConfirmDelete(false);
    setPicker(kind);
  }

  function removeCurrent() {
    setItems((all) => all.filter((_, i) => i !== index));
    setTotal((t) => Math.max(0, t - 1));
    setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    setConfirmDelete(false);
  }

  async function patch(body: Record<string, unknown>) {
    if (!current || busy.current) return;
    busy.current = true;
    setBusyState(true);
    setError(null);
    try {
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
      window.dispatchEvent(new Event("sb:inbox-changed"));
    } finally {
      busy.current = false;
      setBusyState(false);
    }
  }

  async function remove() {
    if (!current || busy.current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    busy.current = true;
    setBusyState(true);
    try {
      const res = await fetch(`/api/items/${current.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Delete failed");
        return;
      }
      removeCurrent();
      window.dispatchEvent(new Event("sb:inbox-changed"));
    } finally {
      busy.current = false;
      setBusyState(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (picker || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      switch (e.key) {
        case "p":
        case "a":
        case "r":
          if (!current) return;
          e.preventDefault();
          openPicker(e.key === "p" ? "project" : e.key === "a" ? "area" : "resource");
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
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-4">
      <PageHeader
        title="Inbox"
        meta={loaded ? (items.length ? `${index + 1} of ${total} to process` : "Everything is filed.") : "Loading"}
        actions={
          <Button variant="ghost" size="sm" icon={mode === "focus" ? ListIcon : Focus} onClick={() => setMode((m) => (m === "focus" ? "list" : "focus"))}>
            {mode === "focus" ? "List" : "Focus"}
            <Kbd>l</Kbd>
          </Button>
        }
      />

      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}

      {loaded && items.length === 0 && (
        <EmptyState
          icon={InboxIcon}
          text="Nothing waiting. Capture something and it will show up here."
          action={
            <Button href="/capture" variant="primary" size="sm">
              Capture something
            </Button>
          }
        />
      )}

      {mode === "list" && items.length > 0 && (
        <List>
          {items.map((item, i) => (
            <Row
              key={item.id}
              className={i === index ? "cursor-pointer bg-slate-2 hover:bg-slate-2" : "cursor-pointer"}
            >
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setMode("focus");
                }}
                className="flex items-center gap-3 w-full h-full min-w-0 text-left"
              >
                <TypeIcon type={item.type} />
                <span className="flex-1 truncate text-[13.5px]">{item.title}</span>
                <span className="font-mono text-[11px] text-fg-faint">{relativeTime(item.createdAt)}</span>
              </button>
            </Row>
          ))}
        </List>
      )}

      {mode === "focus" && current && (
        <section className="rounded-lg border border-hairline bg-slate overflow-hidden">
          <div className="flex items-center gap-3 px-4 h-11 border-b border-hairline">
            <TypeIcon type={current.type} />
            <Link href={`/items/${current.id}`} className="flex-1 truncate text-[13.5px] font-medium hover:text-brass">
              {current.title}
            </Link>
            <StatusDot status={current.status} error={current.error} />
            <span className="font-mono text-[11px] text-fg-faint">{relativeTime(current.createdAt)}</span>
          </div>
          <div className="px-4 py-4 text-[14px] leading-relaxed text-fg-muted min-h-28">
            {current.sourceUrl && (
              <a
                href={current.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-brass truncate mb-2"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                {current.sourceUrl}
              </a>
            )}
            {preview || <span className="text-fg-faint">No text yet.</span>}
          </div>
          {(current.tags.length > 0 || current.people.length > 0) && (
            <div className="px-4 pb-3 flex flex-wrap gap-2 text-[12px] text-fg-faint">
              {current.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
              {current.people.map((p) => (
                <span key={p.id}>@{p.slug}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-3 h-14 border-t border-hairline bg-slate">
            {(
              [
                ["p", "Project", Flag],
                ["a", "Area", Layers],
                ["r", "Resource", BookMarked],
                ["e", "Archive", Archive],
              ] as const
            ).map(([key, label, LabelIcon]) => (
              <Button
                key={key}
                variant="secondary"
                size="sm"
                icon={LabelIcon}
                disabled={busyState}
                onClick={() => {
                  if (key === "e") void patch({ archived: true });
                  else openPicker(key === "p" ? "project" : key === "a" ? "area" : "resource");
                }}
              >
                {label}
                <Kbd>{key}</Kbd>
              </Button>
            ))}
            <Button
              variant={confirmDelete ? "danger" : "secondary"}
              size="sm"
              icon={Trash2}
              disabled={busyState}
              onClick={() => void remove()}
            >
              {confirmDelete ? "Delete for good" : "Delete"}
              <Kbd>x</Kbd>
            </Button>
            <span className="flex-1" />
            <span className="text-[12px] text-fg-faint flex items-center gap-1.5">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move
            </span>
          </div>
        </section>
      )}

      {picker && (
        <ContainerPicker
          kind={picker}
          onClose={() => {
            setPicker(null);
            setConfirmDelete(false);
          }}
          onPick={(c) => {
            setPicker(null);
            setConfirmDelete(false);
            void patch({ containerId: c ? c.id : null });
          }}
        />
      )}
    </div>
  );
}
