"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Editor } from "@tiptap/core";
import { ArrowLeft, Eye, Pencil, Trash2, Save } from "lucide-react";
import type { PersonDTO } from "@/lib/dto";
import { Button, Chip, IconButton } from "./ui";
import { Crumb } from "./shell/crumb";

const RichEditor = dynamic(() => import("./editor/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="doc rich-editor" aria-busy="true" />,
});

export function PersonEditor({ initial, onEditorReady }: { initial: PersonDTO; onEditorReady?: (editor: Editor) => void }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [profile, setProfile] = useState(initial.profile);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors item-editor.tsx's `latest`: RichEditor's ⌘S flush (rich-editor.tsx) calls this
  // host's onChange synchronously before this component's own ⌘S handler runs, but the
  // resulting setProfile hasn't committed yet — so save() reads a ref instead of state.
  const latest = useRef({ name, profile });

  useEffect(() => {
    latest.current = { name, profile };
  }, [name, profile]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { name, profile } = latest.current;
      const res = await fetch(`/api/people/${initial.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, profile }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      const p = (await res.json()) as PersonDTO;
      setDirty(false);
      if (p.slug !== initial.slug) router.replace(`/people/${p.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, profile, saving]);

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/people/${initial.id}`, { method: "DELETE" });
    if (res.ok) router.push("/people");
    else setError("Delete failed");
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The route trail already contributes "People", so the page supplies only its title. */}
      <Crumb title={name} />
      <header className="flex items-center gap-2 h-10 mb-3">
        <Link href="/people" className="focus-ring inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg">
          <ArrowLeft className="w-3.5 h-3.5" />
          People
        </Link>
        <Chip as="span" className="font-mono">@{initial.slug}</Chip>
        <span className={`text-[12px] ${error ? "text-danger" : "text-fg-faint"}`}>{saving ? "Saving" : dirty ? "Unsaved, ⌘S to save" : ""}</span>
        <span className="flex-1" />
        <IconButton label={preview ? "Edit" : "Preview"} icon={preview ? Pencil : Eye} active={preview} onClick={() => setPreview((p) => !p)} />
        <IconButton
          label={confirmDelete ? "Confirm delete" : "Delete"}
          icon={Trash2}
          danger={confirmDelete}
          onClick={() => void remove()}
          onBlur={() => setConfirmDelete(false)}
        />
        <Button variant="primary" icon={Save} disabled={!dirty || saving} onClick={() => void save()}>
          Save changes
        </Button>
      </header>
      {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setDirty(true);
        }}
        className="text-[22px] leading-7 font-medium tracking-[-0.02em] bg-transparent outline-none w-full border-b border-transparent focus:border-hairline-strong transition-colors duration-150"
      />
      {preview ? (
        <div className="pane p-6 md min-h-[200px]">
          <Markdown remarkPlugins={[remarkGfm]}>{profile || "*No profile yet.*"}</Markdown>
        </div>
      ) : (
        <div className="pane p-6">
          <RichEditor
            value={profile}
            onChange={(md) => {
              setProfile(md);
              latest.current = { ...latest.current, profile: md };
              setDirty(true);
            }}
            placeholder="Who they are, their role, how you work together, open threads."
            className="min-h-[200px]"
            onReady={onEditorReady}
          />
        </div>
      )}
    </div>
  );
}
