"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { ArrowLeft, Plus, Check, Archive, RotateCcw, Trash2, FileText, CalendarDays, ChevronRight } from "lucide-react";
import type { ContainerDTO, ItemDTO, ProgressDTO, TaskDTO } from "@/lib/dto";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/db/enums";
import { relativeTime, titleCase, formatDate } from "@/lib/format";
import { setCurrentContainer } from "@/lib/current-container";
import { deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { Button, Chip, EmptyState, IconButton, Input, List, Row, SectionHeading, Select } from "./ui";
import { KindIcon, KIND_LABEL, TypeIcon, StatusDot } from "./type-icon";
import { Crumb } from "./shell/crumb";
import { CompleteProjectDialog } from "./complete-project-dialog";
import { ProgressRing } from "./tasks/progress-ring";
import { TaskList } from "./tasks/task-list";
import { ContainerRail } from "./containers/container-rail";
import { LinksSection } from "./containers/links-section";
import { NotesSection } from "./containers/notes-section";

const ABOUT_LABEL: Record<ContainerDTO["kind"], string> = {
  project: "About this project",
  area: "About this area",
  resource: "About this resource",
};

const RichEditor = dynamic(() => import("./editor/rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="doc rich-editor" aria-busy="true" />,
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(initial.description.trim().length > 0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  // Mirrors item-editor.tsx's in-flight handling: a save already in flight when another edit
  // lands (blur, ⌘S, or the debounce firing again) must not be dropped. `pendingAgain` marks
  // that a follow-up save is owed once the in-flight one settles; `dirtyCounter` (bumped by
  // every markDirty) lets persist() tell whether the edit it just sent is still the latest one.
  const pendingAgain = useRef(false);
  const dirtyCounter = useRef(0);
  // Mirrors item-editor.tsx's `latest`: a RichEditor's ⌘S flush (rich-editor.tsx) calls its
  // onChange synchronously before this component's own ⌘S handler runs, but the resulting
  // setDescription hasn't committed yet — so persist() reads a ref instead of state.
  const latest = useRef({ name, description, goal, deadline, standard, category });
  // `useRouter()` isn't guaranteed reference-stable across renders; keeping it out of persist's
  // dependency array keeps persist's identity stable too, so the unmount-flush effect below
  // doesn't tear down and fire a false flush on every render.
  const routerRef = useRef(router);
  // The name the sidebar tree was last told about, so a save that only touched the body does
  // not make it refetch. `persist` reads it out of a ref because its own deps deliberately
  // exclude the live name.
  const announcedName = useRef(initial.name);

  useEffect(() => {
    latest.current = { name, description, goal, deadline, standard, category };
  }, [name, description, goal, deadline, standard, category]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Tells the prompt bar which container is open, so a capture from it lands here.
  useEffect(() => {
    setCurrentContainer({ id: c.id, name: c.name });
    return () => setCurrentContainer(null);
  }, [c.id, c.name]);

  const persist = useCallback(
    (fromUnmount = false): Promise<void> => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      if (inflight.current) {
        // A save is already in flight: don't return its promise as if it will carry this edit
        // too (it already read `latest` before this edit landed). Mark that another save is
        // owed once it settles, so blur/⌘S/the debounce never silently drop the newer edit.
        pendingAgain.current = true;
        return inflight.current;
      }
      const run = (async () => {
        const dirtyAtStart = dirtyCounter.current;
        setSave("saving");
        setSaveError(null);
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
          if (updated.name !== announcedName.current) {
            announcedName.current = updated.name;
            window.dispatchEvent(new Event("sb:containers-changed"));
          }
          // Only a live save redirects: an unmount flush has no page left to navigate, and
          // redirecting anyway would yank the user to the renamed container's new URL.
          if (!fromUnmount && updated.slug !== c.slug) routerRef.current.replace(`/c/${updated.slug}`);
          const stillDirty = dirtyCounter.current !== dirtyAtStart || pendingAgain.current;
          setSave(stillDirty ? "dirty" : "saved");
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
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
    [c.id, c.kind, c.slug],
  );

  function markDirty() {
    dirtyCounter.current += 1;
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
    // Archiving drops the container out of the sidebar tree's active list; restoring puts it back.
    window.dispatchEvent(new Event("sb:containers-changed"));
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
    error: saveError ? `Could not save: ${saveError}` : "Could not save",
  };

  const nameInput = (
    <input
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        markDirty();
      }}
      onBlur={flushOnBlur}
      className="text-[22px] leading-7 font-medium tracking-[-0.02em] bg-transparent outline-none w-full border-b border-transparent focus:border-hairline-strong transition-colors duration-150"
      placeholder="Name"
    />
  );

  const aboutPanelId = `about-panel-${c.id}`;

  const aboutDisclosure = (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={aboutOpen}
        aria-controls={aboutPanelId}
        onClick={() => setAboutOpen((v) => !v)}
        className="self-start"
      >
        {ABOUT_LABEL[c.kind]}
        <ChevronRight className={`w-3.5 h-3.5 motion-safe:transition-transform ${aboutOpen ? "rotate-90" : ""}`} aria-hidden />
      </Button>
      {aboutOpen && (
        <div id={aboutPanelId} className="pane p-6">
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
        </div>
      )}
    </div>
  );

  const links = items.filter((i) => i.type === "link");
  const notes = items.filter((i) => i.type === "note");
  const others = items.filter((i) => i.type !== "link" && i.type !== "note");

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-4">
      <Crumb title={c.name} parent={{ label: `${KIND_LABEL[c.kind]}s`, href: `/${c.kind}s` }} />
      {/* The rail reads the live task progress, which TaskList owns, not the copy the
        * container DTO was serialized with. */}
      <ContainerRail container={{ ...c, progress }} taskCount={progress.total} itemCount={items.length} />

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
        <section className="pane p-6 flex flex-col gap-4">
          {nameInput}
          <input
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              markDirty();
            }}
            onBlur={flushOnBlur}
            placeholder="What does done look like?"
            className="text-[15px] text-fg-muted bg-transparent outline-none w-full border-b border-transparent focus:border-hairline-strong transition-colors duration-150"
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
          {aboutDisclosure}
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

      {c.kind !== "project" && aboutDisclosure}

      {c.kind === "project" || c.kind === "area" ? (
        <div className="grid grid-cols-1 min-[1200px]:grid-cols-[3fr_2fr] gap-6">
          <div className="flex flex-col gap-2">
            <section className="flex flex-col gap-2">
              <SectionHeading count={progress.open}>Tasks</SectionHeading>
              <TaskList containerId={c.id} initialTasks={tasks} initialProgress={progress} onProgress={setProgress} today={today} />
            </section>
          </div>
          <div className="flex flex-col gap-6">
            <LinksSection containerId={c.id} initial={links} readOnly={c.status === "archived"} />
            <NotesSection containerId={c.id} initial={notes} readOnly={c.status === "archived"} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-6">
          <LinksSection containerId={c.id} initial={links} readOnly={c.status === "archived"} />
          <NotesSection containerId={c.id} initial={notes} readOnly={c.status === "archived"} />
        </div>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeading count={others.length}>Files and other items</SectionHeading>
        {others.length === 0 ? (
          <EmptyState
            icon={FileText}
            text="Nothing else filed here."
            action={
              <Button href={`/capture?to=${c.slug}`} variant="secondary" size="sm" icon={Plus}>
                Capture here
              </Button>
            }
          />
        ) : (
          <List>
            {others.map((item) => (
              <Row key={item.id}>
                <TypeIcon type={item.type} />
                <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13.5px] hover:text-violet-bright">
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
