"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, FileText, Link2, Search, Square } from "lucide-react";
import { detectIntent, type Intent } from "@/lib/intent";
import { useCapture } from "@/lib/use-capture";
import { useCurrentContainer } from "@/lib/current-container";
import type { ItemDTO, TaskDTO } from "@/lib/dto";
import { Kbd } from "../ui";
import { useToast } from "./toasts";
import { PromptMenu, PROMPT_ENTRIES, type PromptEntry } from "./prompt-menu";

const LABEL = "Ask, capture, or add a task";
const JSON_HEADERS = { "content-type": "application/json" };
const MAX_ROWS = 5;
/** A fetched link stops being pending once its reader run finishes. */
const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;
const NARROW = "(max-width: 899px)";
const FIELD = "focus-ring flex-1 min-w-0 bg-transparent rounded-sm px-1 text-[14px] outline-none placeholder:text-fg-faint";

const MODE: Record<Intent["kind"], { label: string; icon: typeof FileText }> = {
  note: { label: "Note", icon: FileText },
  link: { label: "Link", icon: Link2 },
  task: { label: "Task", icon: Square },
  search: { label: "Search", icon: Search },
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function subscribeNarrow(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

function readNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}

const wideOnServer = () => false;

/**
 * One line for everything: a note, a link, a task, or a search. The intent is read from what
 * is typed, so there are no modes to switch between.
 */
export function PromptBar() {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const containerId = useCurrentContainer();
  const { captureNote, captureLink, uploadFiles } = useCapture();
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, wideOnServer);
  const [text, setText] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const intent = detectIntent(text);
  const mode = MODE[intent.kind];
  const empty = text.trim().length === 0;

  const submit = useCallback(async () => {
    if (busy) return;
    const current = detectIntent(text);
    if (current.kind === "search") {
      if (!current.query) return;
      router.push(`/search?q=${encodeURIComponent(current.query)}`);
      setText("");
      setError(null);
      return;
    }
    if (current.kind === "task" && !current.title) {
      setError("Add a task title");
      return;
    }
    if (current.kind === "note" && !current.body) return;
    setBusy(true);
    setError(null);
    try {
      if (current.kind === "task") {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ title: current.title, priority: current.priority, dueDate: current.dueDate, containerId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? res.statusText);
        }
        const task = (await res.json()) as TaskDTO;
        toast.push({
          text: "Task added",
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                const undone = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
                if (undone.ok) window.dispatchEvent(new Event("sb:tasks-changed"));
              })();
            },
          },
        });
        window.dispatchEvent(new Event("sb:tasks-changed"));
      } else if (current.kind === "note") {
        const item = await captureNote(current.body);
        toast.push({ text: "Captured to Inbox", href: `/items/${item.id}` });
        window.dispatchEvent(new Event("sb:inbox-changed"));
      } else {
        const item = await captureLink(current.url);
        if ("duplicate" in item) {
          toast.push({ text: "Already captured", href: `/items/${item.duplicate}` });
        } else {
          toast.push({ text: "Link captured", href: `/items/${item.id}` });
          setPendingItemId(item.id);
        }
        window.dispatchEvent(new Event("sb:inbox-changed"));
      }
      setText("");
      setMultiline(false);
      setMenuOpen(false);
      fieldRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, text, containerId, router, toast, captureNote, captureLink]);

  const sendFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError(null);
      try {
        const created = await uploadFiles(files, { containerId });
        toast.push({ text: `${created.length} file${created.length === 1 ? "" : "s"} captured` });
        window.dispatchEvent(new Event("sb:inbox-changed"));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [uploadFiles, containerId, toast],
  );

  // `c` focuses the bar from anywhere that is not a field, so it never eats a typed letter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "c" || isTyping(e.target)) return;
      e.preventDefault();
      fieldRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A captured link is read in the background; the glow breathes until the item settles.
  useEffect(() => {
    if (pendingItemId === null) return;
    const startedAt = Date.now();
    let stopped = false;
    const timer = setInterval(() => {
      void (async () => {
        if (stopped) return;
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setPendingItemId(null);
          return;
        }
        try {
          const res = await fetch(`/api/items/${pendingItemId}`);
          if (!res.ok || stopped) return;
          const item = (await res.json()) as ItemDTO;
          if (item.status !== "pending") setPendingItemId(null);
        } catch {
          /* offline: keep waiting until the limit */
        }
      })();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pendingItemId]);

  function choose(entry: PromptEntry) {
    setText(`/${entry.word} `);
    setMenuOpen(false);
    fieldRef.current?.focus();
  }

  function onChange(value: string) {
    setText(value);
    setError(null);
    if (value === "/") {
      setMenuIndex(0);
      setMenuOpen(true);
    } else if (!value.startsWith("/") || value.includes(" ")) {
      setMenuOpen(false);
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % PROMPT_ENTRIES.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + PROMPT_ENTRIES.length) % PROMPT_ENTRIES.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        choose(PROMPT_ENTRIES[menuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur();
      return;
    }
    if (e.key !== "Enter") return;
    if (e.shiftKey) {
      // The single line grows into a box; inside the box Shift+Enter is a newline.
      if (!multiline) {
        e.preventDefault();
        setMultiline(true);
      }
      return;
    }
    e.preventDefault();
    void submit();
  }

  function onDropFiles(e: DragEvent<HTMLDivElement>) {
    const dropped = Array.from(e.dataTransfer.files);
    if (!dropped.length) return;
    e.preventDefault();
    void sendFiles(dropped);
  }

  if (pathname === "/capture") return null;

  function onPaste(e: ReactClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    e.preventDefault();
    void sendFiles(pasted);
  }

  const placeholder = narrow ? "Ask or capture" : LABEL;

  return (
    <form
      aria-label={LABEL}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative"
    >
      {/* The bloom is clipped to the bar's own bottom edge: the half that falls below it
        * would otherwise lengthen the page by its own radius. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -top-[480px] overflow-hidden" aria-hidden>
        <div className={`glow -bottom-80 left-1/2 -translate-x-1/2 ${pendingItemId === null ? "" : "glow-breathing"}`} />
      </div>
      {menuOpen && <PromptMenu activeIndex={menuIndex} onChoose={choose} />}
      <div
        onDrop={onDropFiles}
        onDragOver={(e) => e.preventDefault()}
        className="panel relative rounded-lg flex items-start gap-2 px-2.5 py-2 min-h-12"
      >
        <span className="shrink-0 mt-0.5 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-hairline text-[12px] text-fg-muted">
          <mode.icon className="w-3.5 h-3.5" aria-hidden />
          {mode.label}
        </span>
        {multiline ? (
          <textarea
            ref={fieldRef as RefObject<HTMLTextAreaElement>}
            value={text}
            aria-label={LABEL}
            placeholder={placeholder}
            rows={Math.min(MAX_ROWS, text.split("\n").length || 1)}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className={`${FIELD} resize-none py-1 leading-relaxed`}
          />
        ) : (
          <input
            ref={fieldRef as RefObject<HTMLInputElement>}
            type="text"
            value={text}
            aria-label={LABEL}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className={`${FIELD} h-8`}
          />
        )}
        <span className="shrink-0 mt-0.5 flex items-center gap-2">
          <Kbd>⏎</Kbd>
          <button
            type="submit"
            aria-label="Send"
            disabled={empty || busy}
            className="focus-ring bg-violet text-on-violet rounded-full w-8 h-8 inline-flex items-center justify-center transition-opacity duration-150 disabled:opacity-40"
          >
            <ArrowUp className="w-4 h-4" aria-hidden />
          </button>
        </span>
      </div>
      {error && (
        <p className="relative mt-1.5 flex items-center gap-3 text-[12.5px] text-danger">
          {error}
          <button type="button" onClick={() => void submit()} className="focus-ring rounded-sm text-fg-muted hover:text-fg">
            Retry
          </button>
        </p>
      )}
    </form>
  );
}
