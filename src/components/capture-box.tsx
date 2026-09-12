"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { isProbablyUrl } from "@/lib/text";
import type { ContainerDTO, ContainerRefDTO, ItemDTO } from "@/lib/dto";
import { ContainerPicker } from "./container-picker";

interface Props {
  onCaptured: (item: ItemDTO) => void;
  defaultContainer?: ContainerRefDTO | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export function CaptureBox({ onCaptured, defaultContainer }: Props) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState<ContainerRefDTO | null>(defaultContainer ?? null);
  const [picker, setPicker] = useState(false);
  const [duplicate, setDuplicate] = useState<{ existingId: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode: "note" | "link" | "file" = files.length ? "file" : isProbablyUrl(text) ? "link" : "note";
  const canSubmit = !busy && (text.trim().length > 0 || files.length > 0);

  const submit = useCallback(
    async (force = false) => {
      if (!canSubmit) return;
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      setBusy(true);
      setError(null);
      try {
        const created: ItemDTO[] = [];
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("tags", tagList.join(","));
          if (target) form.append("containerId", String(target.id));
          const res = await fetch("/api/upload", { method: "POST", body: form });
          if (!res.ok) throw new Error(await readError(res));
          created.push((await res.json()) as ItemDTO);
        }
        if (text.trim()) {
          const body = isProbablyUrl(text)
            ? { type: "link", url: text.trim(), tags: tagList, containerId: target?.id ?? null, force }
            : { type: "note", body: text, tags: tagList, containerId: target?.id ?? null };
          const res = await fetch("/api/items", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.status === 409) {
            const data = (await res.json()) as { existingId: number };
            setDuplicate({ existingId: data.existingId });
            return;
          }
          if (!res.ok) throw new Error(await readError(res));
          created.push((await res.json()) as ItemDTO);
        }
        setText("");
        setFiles([]);
        setTags("");
        setDuplicate(null);
        created.forEach(onCaptured);
        textareaRef.current?.focus();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [canSubmit, files, text, tags, target, onCaptured],
  );

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
      }}
      className={`rounded-lg border bg-surface-1 transition-colors duration-150 ${dragging ? "border-accent" : "border-line"}`}
    >
      <div className="flex items-center justify-between px-4 h-9 border-b border-line">
        <span className="font-mono text-[10px] tracking-wider text-fg-muted uppercase">
          {mode === "file" ? `${files.length} file${files.length > 1 ? "s" : ""}` : mode}
        </span>
        <span className="font-mono text-[10px] text-fg-faint">⌘↵ to capture</span>
      </div>
      <textarea
        ref={textareaRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            setFiles((f) => [...f, ...pasted]);
          }
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Type a thought, paste a link, or drop a file"
        rows={6}
        className="w-full resize-y bg-transparent px-4 py-3 outline-none leading-relaxed"
      />
      {files.length > 0 && (
        <ul className="px-4 pb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="font-mono text-[11px] bg-surface-3 border border-line rounded-sm px-2 py-1 flex items-center gap-2">
              {f.name}
              <button type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} className="text-fg-faint hover:text-danger">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 px-4 h-11 border-t border-line">
        <button type="button" onClick={() => setPicker(true)} className="h-6 px-2 rounded-sm font-mono text-[10px] tracking-wider uppercase border border-line hover:border-accent hover:text-accent shrink-0">
          {target ? `${target.kind} · ${target.name}` : "inbox"}
        </button>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tags, comma separated"
          className="flex-1 bg-transparent outline-none text-[13px]"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-[12px] text-fg-muted hover:text-fg transition-colors duration-150"
        >
          Attach
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="h-7 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40 transition-opacity duration-150"
        >
          {busy ? "Capturing" : "Capture"}
        </button>
      </div>
      {error && <div className="px-4 py-2 text-[12px] text-danger border-t border-line">{error}</div>}
      {duplicate && (
        <div className="px-4 py-2 text-[12px] border-t border-line flex items-center gap-3">
          <span className="text-warn">Already saved.</span>
          <Link href={`/items/${duplicate.existingId}`} className="text-accent hover:underline">Open it</Link>
          <button type="button" onClick={() => void submit(true)} className="text-fg-muted hover:text-fg">Save anyway</button>
        </div>
      )}
      {picker && (
        <ContainerPicker
          allowInbox
          title="Capture into"
          onClose={() => setPicker(false)}
          onPick={(c: ContainerDTO | null) => {
            setPicker(false);
            setTarget(c ? { id: c.id, name: c.name, slug: c.slug, kind: c.kind } : null);
          }}
        />
      )}
    </section>
  );
}
