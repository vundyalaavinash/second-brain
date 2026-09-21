"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { GripVertical, MoreHorizontal } from "lucide-react";
import type { TaskDTO } from "@/lib/dto";
import type { TaskPriority } from "@/db/enums";
import { deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { titleCase } from "@/lib/format";
import { Button, Chip, IconButton, Input } from "../ui";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatShortDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}`;
}

const MENU_ITEM_FOCUSABLE = '[role="menuitem"], [role="menuitemradio"]';

const MENU_ITEM = "focus-ring w-full flex items-center px-2 h-8 rounded-sm text-left text-[12.5px] text-fg-muted hover:text-fg hover:bg-slate-2 transition-colors duration-100";
const MENU_ITEM_DANGER = "focus-ring w-full flex items-center px-2 h-8 rounded-sm text-left text-[12.5px] text-danger hover:bg-danger/10 transition-colors duration-100";

interface Props {
  task: TaskDTO;
  today: string;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDue: (value: string | null) => void;
  onPriority: (priority: TaskPriority) => void;
  onDrop: () => void;
  onDelete: () => void;
  onMove?: (dir: "up" | "down") => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (e: DragEvent<HTMLLIElement>) => void;
  onRowDrop?: (e: DragEvent<HTMLLIElement>) => void;
}

export function TaskRow({ task, today, onToggle, onRename, onDue, onPriority, onDrop, onDelete, onMove, draggable, onDragStart, onDragOver, onRowDrop }: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDraft, setDueDraft] = useState(task.dueDate ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const done = task.status === "done";
  const due = task.dueDate ? deadlineLabel(task.dueDate, today) : null;

  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  // Positions the portalled menu against its trigger button with floating-ui, same as
  // editor/slash-menu.tsx, and keeps it aligned on scroll/resize while open.
  useEffect(() => {
    if (!menuOpen) return;
    const buttonEl = menuButtonRef.current;
    const menuEl = menuPanelRef.current;
    if (!buttonEl || !menuEl) return;
    return autoUpdate(buttonEl, menuEl, () => {
      void computePosition(buttonEl, menuEl, { placement: "bottom-end", middleware: [offset(4), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        setMenuPos({ top: y, left: x });
      });
    });
  }, [menuOpen]);

  // Focuses the first menu item once the portalled panel has mounted.
  useEffect(() => {
    if (!menuOpen) return;
    const panel = menuPanelRef.current;
    const first = panel?.querySelector<HTMLElement>(MENU_ITEM_FOCUSABLE);
    first?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key === "Tab") {
        const panel = menuPanelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEM_FOCUSABLE));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      closeMenu();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  function startEditTitle() {
    setTitleDraft(task.title);
    setEditingTitle(true);
  }

  function commitTitle() {
    const value = titleDraft.trim();
    setEditingTitle(false);
    if (value && value !== task.title) onRename(value);
    else setTitleDraft(task.title);
  }

  function commitDue(value: string) {
    const next = value || null;
    if (next !== task.dueDate) onDue(next);
  }

  return (
    <li
      role="listitem"
      className="hairline-row group flex items-center gap-3 px-3 h-10 hover:bg-slate-2 transition-colors"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onRowDrop}
    >
      <span className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 cursor-grab text-fg-faint transition-opacity" aria-hidden>
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <input type="checkbox" className="focus-ring accent-brass w-4 h-4 shrink-0" checked={done} aria-label={task.title} onChange={onToggle} />
      {editingTitle ? (
        <Input
          size="sm"
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
            } else if (e.key === "Escape") {
              setTitleDraft(task.title);
              setEditingTitle(false);
            }
          }}
          onBlur={commitTitle}
          className="flex-1 min-w-0"
        />
      ) : (
        <button
          type="button"
          className={`focus-ring text-left flex-1 min-w-0 truncate text-[13.5px] ${done ? "line-through text-fg-faint" : ""}`}
          onClick={startEditTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              startEditTitle();
            }
          }}
        >
          {task.title}
        </button>
      )}
      {task.priority === "high" && (
        <Chip as="span" className="text-warn border-warn/40 shrink-0">
          High
        </Chip>
      )}
      {task.priority === "low" && (
        <Chip as="span" className="text-fg-faint shrink-0">
          Low
        </Chip>
      )}
      {dueOpen ? (
        <Input
          type="date"
          size="sm"
          autoFocus
          value={dueDraft}
          onChange={(e) => {
            setDueDraft(e.target.value);
            commitDue(e.target.value);
          }}
          onBlur={() => {
            commitDue(dueDraft);
            setDueOpen(false);
          }}
          className="font-mono w-36 shrink-0"
        />
      ) : (
        due && (
          <button
            type="button"
            className={`focus-ring font-mono text-[11px] shrink-0 ${TONE_CLASS[due.tone]}`}
            onClick={() => {
              setDueDraft(task.dueDate ?? "");
              setDueOpen(true);
            }}
          >
            {formatShortDate(task.dueDate!)}
          </button>
        )
      )}
      {done ? (
        <Button variant="ghost" size="sm" onClick={onToggle} className="shrink-0">
          Reopen
        </Button>
      ) : (
        <>
          <IconButton
            label="Task actions"
            icon={MoreHorizontal}
            className="shrink-0"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              menuButtonRef.current = e.currentTarget;
              setMenuOpen((v) => !v);
            }}
          />
          {menuOpen &&
            createPortal(
              <div
                ref={menuPanelRef}
                role="menu"
                className="panel rounded-md p-1 flex flex-col gap-0.5 w-max min-w-48 z-50"
                style={{ position: "absolute", top: menuPos.top, left: menuPos.left }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    closeMenu();
                    startEditTitle();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    closeMenu();
                    setDueDraft(task.dueDate ?? "");
                    setDueOpen(true);
                  }}
                >
                  Set due date
                </button>
                <div role="group" aria-label="Priority" className="flex items-center gap-1 px-2 py-1">
                  <span className="text-[11px] text-fg-faint mr-0.5">Priority</span>
                  {(["low", "normal", "high"] as const).map((p) => (
                    <Chip
                      key={p}
                      role="menuitemradio"
                      active={task.priority === p}
                      aria-checked={task.priority === p}
                      onClick={() => {
                        closeMenu();
                        onPriority(p);
                      }}
                    >
                      {titleCase(p)}
                    </Chip>
                  ))}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    closeMenu();
                    onMove?.("up");
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    closeMenu();
                    onMove?.("down");
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    closeMenu();
                    onDrop();
                  }}
                >
                  Drop
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM_DANGER}
                  onClick={() => {
                    closeMenu();
                    onDelete();
                  }}
                >
                  Delete
                </button>
              </div>,
              document.body,
            )}
        </>
      )}
    </li>
  );
}
