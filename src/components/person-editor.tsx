"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import type { PersonDTO } from "@/lib/dto";

export function PersonEditor({ initial }: { initial: PersonDTO }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [profile, setProfile] = useState(initial.profile);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
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
      <header className="flex items-center gap-3 h-8">
        <Link href="/people" className="font-mono text-[11px] text-fg-muted hover:text-fg">← people</Link>
        <span className="font-mono text-[10px] text-fg-faint">@{initial.slug}</span>
        <span className={`font-mono text-[10px] ${error ? "text-danger" : "text-fg-faint"}`}>{saving ? "saving" : dirty ? "unsaved · ⌘S" : ""}</span>
        <span className="flex-1" />
        <button onClick={() => setPreview((p) => !p)} className={`h-7 px-2 rounded-md text-[12px] border ${preview ? "border-accent text-accent" : "border-line hover:border-line-strong"}`}>{preview ? "Edit" : "Preview"}</button>
        <button onClick={() => void remove()} onBlur={() => setConfirmDelete(false)} className={`h-7 px-2 rounded-md text-[12px] border ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}>{confirmDelete ? "Confirm delete" : "Delete"}</button>
        <button onClick={() => void save()} disabled={!dirty || saving} className="h-7 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">Save</button>
      </header>
      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}
      <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="w-full bg-transparent outline-none text-2xl font-medium tracking-tight" />
      {preview ? (
        <div className="md min-h-[200px]"><Markdown>{profile || "*No profile yet.*"}</Markdown></div>
      ) : (
        <textarea value={profile} onChange={(e) => { setProfile(e.target.value); setDirty(true); }} placeholder={"Who they are, role, how you work together, open threads"} className="w-full min-h-[200px] resize-y bg-surface-1 border border-line rounded-lg px-4 py-3 outline-none leading-relaxed" />
      )}
    </div>
  );
}
