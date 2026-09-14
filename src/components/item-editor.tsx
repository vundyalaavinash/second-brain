"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import { ArrowLeft, AtSign, Eye, Pencil, Archive, RotateCcw, Trash2, RefreshCw, ExternalLink, FileText, Plus, Inbox as InboxIcon } from "lucide-react";
import type { ItemDTO } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { Button, Chip, IconButton, Input, Textarea } from "./ui";
import { TypeIcon, StatusDot, TYPE_LABEL, KIND_ICON } from "./type-icon";
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
  const chain = useRef<Promise<void>>(Promise.resolve());

  function enqueue(work: () => Promise<void>): Promise<void> {
    const next = chain.current.then(work, work);
    chain.current = next.catch(() => {});
    return next;
  }

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
          await enqueue(async () => {
            const res = await fetch(`/api/items/${initial.id}`, {
              method: "PATCH",
              keepalive,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }),
            });
            if (!res.ok) throw new Error(res.statusText);
            setItem((await res.json()) as ItemDTO);
          });
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
    try {
      await enqueue(async () => {
        const res = await fetch(`/api/items/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) {
          setActionError(await readError(res));
          return;
        }
        setItem((await res.json()) as ItemDTO);
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
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
    dirty: "Unsaved, autosaves in 5 s",
    saving: "Saving",
    saved: "Saved",
    error: "Save failed",
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-center gap-2 h-10 mb-3">
        <Link href="/library" className="focus-ring inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg">
          <ArrowLeft className="w-3.5 h-3.5" />
          Library
        </Link>
        <span className="font-mono text-[11px] text-fg-faint">#{item.id}</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          <TypeIcon type={item.type} />
          {TYPE_LABEL[item.type]}
        </span>
        <StatusDot status={item.status} error={item.error} />
        <Chip icon={item.container ? KIND_ICON[item.container.kind] : InboxIcon} onClick={() => setMovePicker(true)}>
          {item.container ? item.container.name : "Inbox"}
        </Chip>
        {item.archivedAt && <span className="text-[11.5px] text-warn">Archived</span>}
        <span className={`text-[12px] ${save === "error" ? "text-danger" : "text-fg-faint"}`}>{saveLabel[save]}</span>
        <span className="flex-1" />
        {item.status === "failed" && <IconButton label="Retry" icon={RefreshCw} onClick={() => void retry()} />}
        <IconButton label={preview ? "Edit" : "Preview"} icon={preview ? Pencil : Eye} active={preview} onClick={() => setPreview((p) => !p)} />
        <IconButton
          label={item.archivedAt ? "Restore" : "Archive"}
          icon={item.archivedAt ? RotateCcw : Archive}
          onClick={() => void patchMeta({ archived: !item.archivedAt })}
        />
        <IconButton
          label={confirmDelete ? "Confirm delete" : "Delete"}
          icon={Trash2}
          danger={confirmDelete}
          onClick={() => void remove()}
          onBlur={() => setConfirmDelete(false)}
        />
      </header>

      {item.error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{item.error}</div>}
      {actionError && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{actionError}</div>}

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
        className="text-[22px] leading-7 font-medium tracking-[-0.02em] bg-transparent outline-none w-full border-b border-transparent focus:border-line-strong transition-colors duration-150"
        placeholder="Untitled"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
        <span>
          Created <span className="font-mono">{formatDateTime(item.createdAt)}</span>
        </span>
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline truncate max-w-md">
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
            {item.sourceUrl}
          </a>
        )}
        {meta.site_name && <span>{meta.site_name}</span>}
        {meta.byline && <span>By {meta.byline}</span>}
        {meta.page_count !== undefined && <span>{meta.page_count} pages</span>}
        {item.filePath && (
          <a href={`/api/items/${item.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
            Open file
          </a>
        )}
      </div>

      <Input
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          markDirty();
        }}
        onBlur={() => {
          if (save === "dirty") void persist();
        }}
        placeholder="Add tags, separated by commas"
        size="sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        {item.people.map((p) => (
          <Chip key={p.id} href={`/people/${p.slug}`} icon={AtSign} className="font-mono">
            {p.slug}
          </Chip>
        ))}
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setPeoplePicker(true)}>
          Add person
        </Button>
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
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            markDirty();
          }}
          onBlur={() => {
            if (save === "dirty") void persist();
          }}
          placeholder={item.type === "note" ? "Write in markdown" : "Your notes about this item"}
          className="min-h-[260px] text-[14.5px]"
        />
      )}

      {item.extractedText && (
        <details className="rounded-md border border-line bg-surface-1">
          <summary className="px-4 h-10 flex items-center gap-2 cursor-pointer text-[13px] text-fg-muted select-none">
            <FileText className="w-4 h-4" aria-hidden />
            Extracted text <span className="font-mono text-[11px] text-fg-faint">{item.extractedText.length.toLocaleString()} characters</span>
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
