"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import type { ItemDTO } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { StatusBadge, TypeBadge } from "./badges";
import { ContainerPicker } from "./container-picker";
import { PeoplePicker } from "./people-picker";

const SAVE_DEBOUNCE_MS = 5000;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    // not JSON, fall through
  }
  return res.statusText || "Request failed";
}

export function ItemEditor({ initial }: { initial: ItemDTO }) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [save, setSave] = useState<SaveState>("idle");
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [movePicker, setMovePicker] = useState(false);
  const [peoplePicker, setPeoplePicker] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ title, body, tags });
  const titleTouched = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const pendingAgain = useRef(false);
  const dirtyCounter = useRef(0);

  useEffect(() => {
    latest.current = { title, body, tags };
  }, [title, body, tags]);

  const persist = useCallback(
    (keepalive = false): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      if (inflight.current) {
        pendingAgain.current = true;
        return inflight.current;
      }
      const run = (async () => {
        const dirtyAtStart = dirtyCounter.current;
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
          const stillDirty = dirtyCounter.current !== dirtyAtStart || pendingAgain.current;
          setSave(stillDirty ? "dirty" : "saved");
        } catch {
          setSave("error");
        } finally {
          inflight.current = null;
          if (pendingAgain.current) {
            pendingAgain.current = false;
            void persist();
          }
        }
      })();
      inflight.current = run;
      return run;
    },
    [initial.id],
  );

  function markDirty() {
    dirtyCounter.current += 1;
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
      if (!titleTouched.current) setTitle(dto.title);
    }, 2000);
    return () => clearInterval(id);
  }, [item.status, initial.id]);

  async function patchMeta(body: Record<string, unknown>) {
    setActionError(null);
    const res = await fetch(`/api/items/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setActionError(await readError(res));
      return;
    }
    setItem((await res.json()) as ItemDTO);
  }

  async function retry() {
    const res = await fetch(`/api/items/${initial.id}/retry`, { method: "POST" });
    if (!res.ok) {
      setActionError(await readError(res));
      return;
    }
    setActionError(null);
    setItem((it) => ({ ...it, status: "pending", error: null }));
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/items/${initial.id}`, { method: "DELETE" });
    if (!res.ok) {
      setActionError(await readError(res));
      setConfirmDelete(false);
      return;
    }
    setActionError(null);
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
        <button onClick={() => setMovePicker(true)} className="h-6 px-2 rounded-sm font-mono text-[10px] tracking-wider uppercase border border-line hover:border-accent hover:text-accent">
          {item.container ? `${item.container.kind} · ${item.container.name}` : "inbox"}
        </button>
        {item.archivedAt && <span className="font-mono text-[10px] text-warn">archived</span>}
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
        <button onClick={() => void patchMeta({ archived: !item.archivedAt })} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong">
          {item.archivedAt ? "Restore" : "Archive"}
        </button>
      </header>

      {item.error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{item.error}</div>}
      {actionError && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{actionError}</div>}

      <input
        value={title}
        onChange={(e) => {
          titleTouched.current = true;
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

      <div className="flex flex-wrap items-center gap-2">
        {item.people.map((p) => (
          <Link key={p.id} href={`/people/${p.slug}`} className="font-mono text-[11px] text-fg-muted hover:text-accent">@{p.slug}</Link>
        ))}
        <button onClick={() => setPeoplePicker(true)} className="font-mono text-[11px] text-fg-faint hover:text-fg">+ person</button>
      </div>

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

      {movePicker && (
        <ContainerPicker
          allowInbox
          onClose={() => setMovePicker(false)}
          onPick={(c) => {
            setMovePicker(false);
            void patchMeta({ containerId: c ? c.id : null });
          }}
        />
      )}
      {peoplePicker && (
        <PeoplePicker selected={item.people.map((p) => p.id)} onChange={(ids) => void patchMeta({ people: ids })} onClose={() => setPeoplePicker(false)} />
      )}
    </div>
  );
}
