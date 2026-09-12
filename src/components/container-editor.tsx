"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ContainerDTO, ItemDTO } from "@/lib/dto";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/db/enums";
import { StatusBadge, TypeBadge } from "./badges";
import { relativeTime } from "@/lib/format";
import { CompleteProjectDialog } from "./complete-project-dialog";

const KIND_LABEL = { project: "Project", area: "Area", resource: "Resource" } as const;

export function ContainerEditor({ initial, items }: { initial: ContainerDTO; items: ItemDTO[] }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [goal, setGoal] = useState(initial.goal);
  const [deadline, setDeadline] = useState(initial.deadline ?? "");
  const [standard, setStandard] = useState(initial.standard);
  const [category, setCategory] = useState<ResourceCategory>(initial.category ?? "other");
  const [nextSteps, setNextSteps] = useState(initial.nextSteps);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, description, nextSteps };
      if (c.kind === "project") Object.assign(body, { goal, deadline: deadline || null });
      if (c.kind === "area") body.standard = standard;
      if (c.kind === "resource") body.category = category;
      const res = await fetch(`/api/containers/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      const updated = (await res.json()) as ContainerDTO;
      setC(updated);
      setDirty(false);
      if (updated.slug !== c.slug) router.replace(`/c/${updated.slug}`);
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
  }, [name, description, goal, deadline, standard, category, nextSteps, c.id, c.kind, saving]);

  async function archiveOrRestore() {
    setError(null);
    const url = c.status === "archived" ? `/api/containers/${c.id}/restore` : `/api/containers/${c.id}/archive`;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      return;
    }
    setC((await res.json()) as ContainerDTO);
    router.refresh();
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const res = await fetch(`/api/containers/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      setConfirmDelete(false);
      return;
    }
    router.push(`/${c.kind}s`);
  }

  const field = "w-full bg-surface-1 border border-line rounded-md px-3 py-2 text-[13px] outline-none focus:border-accent";
  const mark = () => setDirty(true);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-center gap-3 h-8">
        <Link href={`/${c.kind}s`} className="font-mono text-[11px] text-fg-muted hover:text-fg">
          ← {KIND_LABEL[c.kind].toLowerCase()}s
        </Link>
        <span className="font-mono text-[10px] tracking-wider uppercase text-fg-muted border border-line rounded-sm px-1.5 py-0.5">{KIND_LABEL[c.kind]}</span>
        {c.status === "archived" && <span className="font-mono text-[10px] text-warn">archived</span>}
        <span className={`font-mono text-[10px] ${error ? "text-danger" : "text-fg-faint"}`}>{saving ? "saving" : dirty ? "unsaved · ⌘S" : ""}</span>
        <span className="flex-1" />
        <Link href={`/capture?to=${c.slug}`} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong flex items-center">
          Capture here
        </Link>
        {c.status === "active" && c.kind === "project" && (
          <button onClick={() => setComplete(true)} className="h-7 px-2 rounded-md text-[12px] border border-accent text-accent">
            Complete
          </button>
        )}
        {(c.status === "archived" || c.kind !== "project") && (
          <button onClick={() => void archiveOrRestore()} className="h-7 px-2 rounded-md text-[12px] border border-line hover:border-line-strong">
            {c.status === "archived" ? "Restore" : "Archive"}
          </button>
        )}
        {c.itemCount === 0 && (
          <button onClick={() => void remove()} onBlur={() => setConfirmDelete(false)} className={`h-7 px-2 rounded-md text-[12px] border ${confirmDelete ? "border-danger text-danger" : "border-line hover:border-line-strong"}`}>
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        )}
        <button onClick={() => void save()} disabled={!dirty || saving} className="h-7 px-3 rounded-md text-[12px] font-medium bg-accent text-bg disabled:opacity-40">
          Save
        </button>
      </header>

      {error && <div className="text-[12px] text-danger border border-danger/40 rounded-md px-3 py-2">{error}</div>}

      <input value={name} onChange={(e) => { setName(e.target.value); mark(); }} className="w-full bg-transparent outline-none text-2xl font-medium tracking-tight" placeholder="Name" />

      {c.kind === "project" && (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <input value={goal} onChange={(e) => { setGoal(e.target.value); mark(); }} placeholder="Goal: what does done look like?" className={field} />
          <input type="date" value={deadline} onChange={(e) => { setDeadline(e.target.value); mark(); }} className={`${field} font-mono text-[12px]`} />
        </div>
      )}
      {c.kind === "area" && (
        <input value={standard} onChange={(e) => { setStandard(e.target.value); mark(); }} placeholder="Standard: what does good look like here?" className={field} />
      )}
      {c.kind === "resource" && (
        <select value={category} onChange={(e) => { setCategory(e.target.value as ResourceCategory); mark(); }} className={`${field} max-w-xs font-mono text-[12px]`}>
          {RESOURCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      )}

      <textarea value={description} onChange={(e) => { setDescription(e.target.value); mark(); }} placeholder="Description" rows={3} className={`${field} resize-y`} />

      {c.kind === "project" && (
        <section className="flex flex-col gap-1">
          <label className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Next steps</label>
          <textarea value={nextSteps} onChange={(e) => { setNextSteps(e.target.value); mark(); }} placeholder={"- [ ] first step"} rows={4} className={`${field} resize-y font-mono text-[12.5px]`} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Items · {items.length}</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">Nothing filed here yet.</li>}
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 h-9 hover:bg-surface-2 transition-colors duration-150">
              <TypeBadge type={item.type} />
              <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{item.title}</Link>
              <StatusBadge status={item.status} error={item.error} />
              <span className="font-mono text-[10px] text-fg-faint">{relativeTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      {complete && (
        <CompleteProjectDialog
          container={c}
          onClose={() => setComplete(false)}
          onDone={() => {
            setComplete(false);
            router.push("/projects");
          }}
        />
      )}
    </div>
  );
}
