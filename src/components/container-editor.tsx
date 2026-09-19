"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { ArrowLeft, Plus, Check, Save, Archive, RotateCcw, Trash2, FileText } from "lucide-react";
import type { ContainerDTO, ItemDTO } from "@/lib/dto";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/db/enums";
import { relativeTime, titleCase } from "@/lib/format";
import { Button, EmptyState, IconButton, Input, List, Row, SectionHeading, Select } from "./ui";
import { KindIcon, KIND_LABEL, TypeIcon, StatusDot } from "./type-icon";
import { CompleteProjectDialog } from "./complete-project-dialog";

const RichEditor = dynamic(() => import("./editor/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="md rich-editor" aria-busy="true" />,
});

export function ContainerEditor({ initial, items, onEditorReady }: { initial: ContainerDTO; items: ItemDTO[]; onEditorReady?: (editor: Editor) => void }) {
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
  // Mirrors person-editor.tsx's `latest`: a RichEditor's ⌘S flush (rich-editor.tsx) calls its
  // onChange synchronously before this component's own ⌘S handler runs, but the resulting
  // setDescription/setNextSteps hasn't committed yet — so save() reads a ref instead of state.
  const latest = useRef({ name, description, goal, deadline, standard, category, nextSteps });

  useEffect(() => {
    latest.current = { name, description, goal, deadline, standard, category, nextSteps };
  }, [name, description, goal, deadline, standard, category, nextSteps]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { name, description, goal, deadline, standard, category, nextSteps } = latest.current;
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

  const mark = () => setDirty(true);
  const saveText = saving ? "Saving" : dirty ? "Unsaved, ⌘S to save" : "";

  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-center gap-2 h-10 mb-3">
        <Link href={`/${c.kind}s`} className="focus-ring inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg">
          <ArrowLeft className="w-3.5 h-3.5" />
          {KIND_LABEL[c.kind]}s
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          <KindIcon kind={c.kind} />
          {KIND_LABEL[c.kind]}
        </span>
        {c.status === "archived" && <span className="text-[11.5px] text-warn">Archived</span>}
        <span className={`text-[12px] ${error ? "text-danger" : "text-fg-faint"}`}>{saveText}</span>
        <span className="flex-1" />
        <Button href={`/capture?to=${c.slug}`} variant="secondary" size="sm" icon={Plus}>
          Capture here
        </Button>
        {c.status === "active" && c.kind === "project" && (
          <Button variant="primary" icon={Check} onClick={() => setComplete(true)}>
            Complete
          </Button>
        )}
        {(c.status === "archived" || c.kind !== "project") && (
          <IconButton
            label={c.status === "archived" ? "Restore" : `Archive ${c.kind}`}
            icon={c.status === "archived" ? RotateCcw : Archive}
            onClick={() => void archiveOrRestore()}
          />
        )}
        {c.totalItemCount === 0 && (
          <IconButton
            label={confirmDelete ? "Confirm delete" : "Delete"}
            icon={Trash2}
            danger={confirmDelete}
            onClick={() => void remove()}
            onBlur={() => setConfirmDelete(false)}
          />
        )}
        <Button variant="primary" icon={Save} disabled={!dirty || saving} onClick={() => void save()}>
          Save changes
        </Button>
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          mark();
        }}
        className="text-[22px] leading-7 font-medium tracking-[-0.02em] bg-transparent outline-none w-full border-b border-transparent focus:border-line-strong transition-colors duration-150"
        placeholder="Name"
      />

      {c.kind === "project" && (
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Input
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              mark();
            }}
            placeholder="What does done look like?"
          />
          <Input
            type="date"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              mark();
            }}
            size="sm"
            className="font-mono"
          />
        </div>
      )}
      {c.kind === "area" && (
        <Input
          value={standard}
          onChange={(e) => {
            setStandard(e.target.value);
            mark();
          }}
          placeholder="What does good look like here?"
        />
      )}
      {c.kind === "resource" && (
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as ResourceCategory);
            mark();
          }}
          className="max-w-xs"
        >
          {RESOURCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {titleCase(cat)}
            </option>
          ))}
        </Select>
      )}

      <RichEditor
        value={description}
        onChange={(md) => {
          setDescription(md);
          latest.current = { ...latest.current, description: md };
          mark();
        }}
        placeholder="Description"
        className="min-h-[120px]"
        onReady={onEditorReady}
      />

      {c.kind === "project" && (
        <section className="flex flex-col gap-1">
          <SectionHeading>Next steps</SectionHeading>
          <RichEditor
            value={nextSteps}
            onChange={(md) => {
              setNextSteps(md);
              latest.current = { ...latest.current, nextSteps: md };
              mark();
            }}
            placeholder="- [ ] First step"
            className="min-h-[120px]"
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeading count={items.length}>Items</SectionHeading>
        {items.length === 0 ? (
          <EmptyState
            icon={FileText}
            text="Nothing filed here yet."
            action={
              <Button href={`/capture?to=${c.slug}`} variant="secondary" size="sm" icon={Plus}>
                Capture here
              </Button>
            }
          />
        ) : (
          <List>
            {items.map((item) => (
              <Row key={item.id}>
                <TypeIcon type={item.type} />
                <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13.5px] hover:text-accent">
                  {item.title}
                </Link>
                <StatusDot status={item.status} error={item.error} />
                <span className="font-mono text-[11px] text-fg-faint">{relativeTime(item.createdAt)}</span>
              </Row>
            ))}
          </List>
        )}
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
