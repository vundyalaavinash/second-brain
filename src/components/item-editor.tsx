"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import type { ItemDTO } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { StatusBadge, TypeBadge } from "./badges";

const SAVE_DEBOUNCE_MS = 5000;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function ItemEditor({ initial }: { initial: ItemDTO }) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [save, setSave] = useState<SaveState>("idle");
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ title, body, tags });
  const userEdited = useRef(false);

  useEffect(() => {
    latest.current = { title, body, tags };
  }, [title, body, tags]);

  const persist = useCallback(
    async (keepalive = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
      const { title, body, tags } = latest.current;
      setSave("saving");
      try {
        const res = await fetch(`/api/items/${initial.id}`, {
          method: "PATCH",
          keepalive,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }),
        });
        if (!res.ok) throw new Error(res.statusText);
        setItem((await res.json()) as ItemDTO);
        setSave("saved");
      } catch {
        setSave("error");
      }
    },
    [initial.id],
  );

  function markDirty() {
    userEdited.current = true;
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void persist(true);
      }
    };
  }, [persist]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persist();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [persist]);

  useEffect(() => {
    if (item.status !== "pending" && item.status !== "processing") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/items/${initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const dto = (await res.json()) as ItemDTO;
      setItem(dto);
      if (!userEdited.current) setTitle(dto.title);
    }, 2000);
    return () => clearInterval(id);
  }, [item.status, initial.id]);

  async function retry() {
    await fetch(`/api/items/${initial.id}/retry`, { method: "POST" });
    setItem((it) => ({ ...it, status: "pending", error: null }));
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await fetch(`/api/items/${initial.id}`, { method: "DELETE" });
    router.push("/library");
  }

  const meta = item.meta as { site_name?: string; byline?: string; page_count?: number; kind?: string };
  const isImage = item.type === "file" && item.mimeType?.startsWith("image/");
  const isPdf = item.type === "file" && item.mimeType === "application/pdf";
  const saveLabel: Record<SaveState, string> = {
    idle: "",
    dirty: "unsaved · autosaves in 5s",
    saving: "saving",
    saved: "saved",
    error: "save failed",
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-center gap-3 h-8">
        <Link href="/library" className="font-mono text-[11px] text-fg-muted hover:text-fg">
          ← library
        </Link>
        <span className="font-mono text-[10px] text-fg-faint">#{item.id}</span>
        <TypeBadge type={item.type} />
        <StatusBadge status={item.status} error={item.error} />
        <span className={`font-mono text-[10px] ${save === "error" ? "text-danger" : "text-fg-faint"}`}>{saveLabel[save]}</span>
        <span className="flex-1" />
        {item.status === "failed" && (
          <button onClick={() => void retry()} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong">
            Retry
          </button>
        )}
        <button
          onClick={() => setPreview((p) => !p)}
          className={`h-7 px-2 rounded-md text-[12px] border ${preview ? "border-accent text-accent" : "border-line hover:border-line-strong"}`}
        >
          {preview ? "Edit" : "Preview"}
        </button>
        <button
          onClick={() => void remove()}
          onBlur={() => setConfirmDelete(false)}
          className={`h-7 px-2 rounded-md text-[12px] border ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
      </header>

      {item.error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{item.error}</div>}

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          markDirty();
        }}
        onBlur={() => {
          if (save === "dirty") void persist();
        }}
        className="w-full bg-transparent outline-none text-2xl font-medium tracking-tight"
        placeholder="Untitled"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
        <span>created {formatDateTime(item.createdAt)}</span>
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline truncate max-w-md">
            {item.sourceUrl}
          </a>
        )}
        {meta.site_name && <span>{meta.site_name}</span>}
        {meta.byline && <span>by {meta.byline}</span>}
        {meta.page_count !== undefined && <span>{meta.page_count} pages</span>}
        {item.filePath && (
          <a href={`/api/items/${item.id}/file`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            open file
          </a>
        )}
      </div>

      <input
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          markDirty();
        }}
        onBlur={() => {
          if (save === "dirty") void persist();
        }}
        placeholder="tags, comma separated"
        className="w-full bg-transparent outline-none text-[12px] text-fg-muted border-b border-line pb-2"
      />

      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin API route, next/image cannot proxy it
        <img src={`/api/items/${item.id}/file`} alt={item.title} className="max-h-96 rounded-md border border-line object-contain self-start" />
      )}
      {isPdf && (
        <iframe src={`/api/items/${item.id}/file`} title={item.title} className="w-full h-[480px] rounded-md border border-line bg-surface-2" />
      )}

      {preview ? (
        <div className="md min-h-[240px]">
          <Markdown>{body || "*Nothing written yet.*"}</Markdown>
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            markDirty();
          }}
          onBlur={() => {
            if (save === "dirty") void persist();
          }}
          placeholder={item.type === "note" ? "Write in markdown" : "Your notes about this item"}
          className="w-full min-h-[240px] resize-y bg-surface-1 border border-line rounded-lg px-4 py-3 outline-none leading-relaxed font-sans"
        />
      )}

      {item.extractedText && (
        <details className="border border-line rounded-lg bg-surface-1">
          <summary className="px-4 h-9 flex items-center cursor-pointer font-mono text-[10px] tracking-wider uppercase text-fg-muted select-none">
            Extracted text · {item.extractedText.length.toLocaleString()} chars
          </summary>
          <pre className="px-4 py-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-muted font-sans max-h-[480px] overflow-y-auto border-t border-line">
            {item.extractedText}
          </pre>
        </details>
      )}
    </div>
  );
}
