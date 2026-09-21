"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Paperclip, CornerDownLeft, Inbox as InboxIcon, FileText, Link2, File as FileIcon, X } from "lucide-react";
import { isProbablyUrl } from "@/lib/text";
import type { ContainerDTO, ContainerRefDTO, ItemDTO } from "@/lib/dto";
import { ContainerPicker } from "./container-picker";
import { Button, Chip, Kbd } from "./ui";
import { KindIcon } from "./type-icon";

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
        // Text/link goes first: a 409 duplicate must not have already uploaded (and thus
        // re-uploaded on "Save anyway") any attached files.
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
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("tags", tagList.join(","));
          if (target) form.append("containerId", String(target.id));
          const res = await fetch("/api/upload", { method: "POST", body: form });
          if (!res.ok) throw new Error(await readError(res));
          created.push((await res.json()) as ItemDTO);
        }
        setText("");
        setFiles([]);
        setTags("");
        setDuplicate(null);
        created.forEach(onCaptured);
        window.dispatchEvent(new Event("sb:inbox-changed"));
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
        setDuplicate(null);
      }}
      className={`rounded-lg border bg-slate transition-colors duration-150 focus-within:border-hairline-strong ${dragging ? "border-brass" : "border-hairline"}`}
    >
      <div className="flex items-center justify-between px-4 h-9 border-b border-hairline">
        <span className="flex items-center gap-1.5">
          {mode === "file" ? (
            <FileIcon className="w-3.5 h-3.5 text-fg-muted" />
          ) : mode === "link" ? (
            <Link2 className="w-3.5 h-3.5 text-fg-muted" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-fg-muted" />
          )}
          <span className="text-[12px] text-fg-muted">
            {mode === "file" ? `${files.length} file${files.length > 1 ? "s" : ""}` : mode === "link" ? "Link" : "Note"}
          </span>
        </span>
        <span className="text-[12px] text-fg-faint flex items-center gap-1.5">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to capture
        </span>
      </div>
      <textarea
        ref={textareaRef}
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDuplicate(null);
        }}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            setFiles((f) => [...f, ...pasted]);
            setDuplicate(null);
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
        className="w-full resize-y bg-transparent px-4 py-3 outline-none leading-relaxed text-[14.5px]"
      />
      {files.length > 0 && (
        <ul className="px-4 pb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="rounded-full border border-hairline bg-slate px-2.5 h-7 text-[12px] flex items-center gap-2">
              {f.name}
              <button
                type="button"
                aria-label="Remove file"
                onClick={() => {
                  setFiles((all) => all.filter((_, j) => j !== i));
                  setDuplicate(null);
                }}
                className="text-fg-faint hover:text-danger"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 px-4 h-11 border-t border-hairline focus-within:border-hairline-strong">
        <Chip icon={target ? undefined : InboxIcon} onClick={() => setPicker(true)}>
          {target ? (
            <>
              <KindIcon kind={target.kind} className="w-3.5 h-3.5" />
              {target.name}
            </>
          ) : (
            "Inbox"
          )}
        </Chip>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Add tags, separated by commas"
          className="flex-1 bg-transparent outline-none text-[13px]"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]);
            setDuplicate(null);
          }}
        />
        <Button variant="ghost" size="sm" icon={Paperclip} onClick={() => fileInputRef.current?.click()}>
          Attach
        </Button>
        <Button variant="primary" size="sm" icon={CornerDownLeft} disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Capturing" : "Capture"}
        </Button>
      </div>
      {error && <div className="px-4 py-2.5 text-[12.5px] text-danger border-t border-hairline">{error}</div>}
      {duplicate && (
        <div className="px-4 py-2.5 border-t border-hairline flex items-center gap-3 text-[12.5px]">
          <span className="text-warn">Already saved.</span>
          <Link href={`/items/${duplicate.existingId}`} className="text-brass hover:underline">Open it</Link>
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
            setDuplicate(null);
          }}
        />
      )}
    </section>
  );
}
