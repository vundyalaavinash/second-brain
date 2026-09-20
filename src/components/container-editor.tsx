"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { ArrowLeft, Plus, Check, Archive, RotateCcw, Trash2, FileText, CalendarDays } from "lucide-react";
import type { ContainerDTO, ItemDTO, ProgressDTO, TaskDTO } from "@/lib/dto";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/db/enums";
import { relativeTime, titleCase, formatDate } from "@/lib/format";
import { deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { Button, Chip, EmptyState, IconButton, Input, List, Row, SectionHeading, Select } from "./ui";
import { KindIcon, KIND_LABEL, TypeIcon, StatusDot } from "./type-icon";
import { CompleteProjectDialog } from "./complete-project-dialog";
import { ProgressRing } from "./tasks/progress-ring";
import { TaskList } from "./tasks/task-list";

const RichEditor = dynamic(() => import("./editor/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="md rich-editor" aria-busy="true" />,
});

const SAVE_DEBOUNCE_MS = 2000;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function ContainerEditor({
  initial,
  items,
  tasks,
  today,
  onEditorReady,
}: {
  initial: ContainerDTO;
  items: ItemDTO[];
  tasks: TaskDTO[];
  today: string;
  onEditorReady?: (editor: Editor) => void;
}) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [goal, setGoal] = useState(initial.goal);
  const [deadline, setDeadline] = useState(initial.deadline ?? "");
  const [standard, setStandard] = useState(initial.standard);
  const [category, setCategory] = useState<ResourceCategory>(initial.category ?? "other");
  const [progress, setProgress] = useState<ProgressDTO>(initial.progress);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  // Mirrors item-editor.tsx's `latest`: a RichEditor's ⌘S flush (rich-editor.tsx) calls its
  // onChange synchronously before this component's own ⌘S handler runs, but the resulting
  // setDescription hasn't committed yet — so persist() reads a ref instead of state.
  const latest = useRef({ name, description, goal, deadline, standard, category });
  // `useRouter()` isn't guaranteed reference-stable across renders; keeping it out of persist's
  // dependency array keeps persist's identity stable too, so the unmount-flush effect below
  // doesn't tear down and fire a false flush on every render.
  const routerRef = useRef(router);

  useEffect(() => {
    latest.current = { name, description, goal, deadline, standard, category };
  }, [name, description, goal, deadline, standard, category]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const persist = useCallback(
    (fromUnmount = false): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      if (inflight.current) return inflight.current;
      const run = (async () => {
        setSave("saving");
        try {
          const { name, description, goal, deadline, standard, category } = latest.current;
          const body: Record<string, unknown> = { name, description };
          if (c.kind === "project") Object.assign(body, { goal, deadline: deadline || null });
          if (c.kind === "area") body.standard = standard;
          if (c.kind === "resource") body.category = category;
          const res = await fetch(`/api/containers/${c.id}`, {
            method: "PATCH",
            keepalive: fromUnmount,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
          const updated = (await res.json()) as ContainerDTO;
          setC(updated);
          setSave("saved");
          if (updated.slug !== c.slug) routerRef.current.replace(`/c/${updated.slug}`);
        } catch {
          setSave("error");
        } finally {
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    [c.id, c.kind, c.slug],
  );

  function markDirty() {
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }

  function flushOnBlur() {
    if (save === "dirty") void persist();
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
    if (save !== "saved") return;
    const id = setTimeout(() => setSave("idle"), 2000);
    return () => clearTimeout(id);
  }, [save]);

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

  const saveLabel: Record<SaveState, string> = {
    idle: "",
    dirty: "Unsaved, autosaves in 2 s",
    saving: "Saving",
    saved: "Saved",
    error: "Could not save",
  };

  const nameInput = (
    <input
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        markDirty();
      }}
      onBlur={flushOnBlur}
      className="text-[22px] leading-7 font-medium tracking-[-0.02em] bg-transparent outline-none w-full border-b border-transparent focus:border-line-strong transition-colors duration-150"
      placeholder="Name"
    />
  );

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-4">
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
        <span className={`text-[12px] ${save === "error" ? "text-danger" : "text-fg-faint"}`}>{saveLabel[save]}</span>
        <span className="flex-1" />
        <Button href={`/capture?to=${c.slug}`} variant="secondary" size="sm" icon={Plus}>
          Capture here
        </Button>
        {(c.status === "archived" || c.kind !== "project") && (
          <IconButton
            label={c.status === "archived" ? "Restore" : `Archive ${c.kind}`}
            icon={c.status === "archived" ? RotateCcw : Archive}
            onClick={() => void archiveOrRestore()}
          />
        )}
        {c.totalItemCount === 0 && progress.total === 0 && (
          <IconButton
            label={confirmDelete ? "Confirm delete" : "Delete"}
            icon={Trash2}
            danger={confirmDelete}
            onClick={() => void remove()}
            onBlur={() => setConfirmDelete(false)}
          />
        )}
      </header>

      {error && <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{error}</div>}

      {c.kind === "project" ? (
        <section className="rounded-lg border border-line bg-surface-1 p-6 flex flex-col gap-4">
          {nameInput}
          <input
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              markDirty();
            }}
            onBlur={flushOnBlur}
            placeholder="What does done look like?"
            className="text-[15px] text-fg-muted bg-transparent outline-none w-full border-b border-transparent focus:border-line-strong transition-colors duration-150"
          />
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-3">
              <ProgressRing percent={progress.percent} size={56} stroke={4} />
              <div className="text-[13px] text-fg-muted">
                <span className="font-mono text-fg">{progress.done}</span> of <span className="font-mono text-fg">{progress.total}</span> done
              </div>
            </div>
            <DeadlineControl
              value={deadline}
              today={today}
              onChange={(v) => {
                setDeadline(v);
                markDirty();
              }}
              onBlur={flushOnBlur}
            />
            <span className="flex-1" />
            {c.status === "active" && (
              <Button variant="primary" icon={Check} onClick={() => setComplete(true)}>
                Complete
              </Button>
            )}
          </div>
        </section>
      ) : (
        nameInput
      )}

      {c.kind === "area" && (
        <Input
          value={standard}
          onChange={(e) => {
            setStandard(e.target.value);
            markDirty();
          }}
          onBlur={flushOnBlur}
          placeholder="What does good look like here?"
        />
      )}
      {c.kind === "resource" && (
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as ResourceCategory);
            markDirty();
          }}
          onBlur={flushOnBlur}
          className="max-w-xs"
        >
          {RESOURCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {titleCase(cat)}
            </option>
          ))}
        </Select>
      )}

      {(c.kind === "project" || c.kind === "area") && (
        <section className="flex flex-col gap-2">
          <SectionHeading count={progress.open}>Tasks</SectionHeading>
          <TaskList containerId={c.id} initialTasks={tasks} initialProgress={progress} onProgress={setProgress} today={today} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeading>Notes</SectionHeading>
        <RichEditor
          value={description}
          onChange={(md) => {
            setDescription(md);
            latest.current = { ...latest.current, description: md };
            markDirty();
          }}
          onBlur={flushOnBlur}
          placeholder="Description"
          className="min-h-[120px]"
          onReady={onEditorReady}
        />
      </section>

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

function DeadlineControl({
  value,
  today,
  onChange,
  onBlur,
}: {
  value: string;
  today: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Input
        type="date"
        size="sm"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onBlur?.();
        }}
        className="font-mono w-40"
      />
    );
  }
  const due = value ? deadlineLabel(value, today) : null;
  const label = value ? `Due ${formatDate(`${value}T00:00:00`)}, ${due!.text}` : "Set a deadline";
  return (
    <Chip icon={CalendarDays} onClick={() => setEditing(true)}>
      {due ? <span className={TONE_CLASS[due.tone]}>{label}</span> : label}
    </Chip>
  );
}
