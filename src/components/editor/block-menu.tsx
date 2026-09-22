"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { ArrowDown, ArrowUp, Copy, Trash2, type LucideIcon } from "lucide-react";
import { Chip } from "../ui";
import { blockKindAt, deleteBlock, duplicateBlock, moveBlock, turnInto, type BlockKind } from "./block-utils";

export const BLOCK_KINDS: { kind: BlockKind; label: string }[] = [
  { kind: "paragraph", label: "Text" },
  { kind: "h1", label: "Heading 1" },
  { kind: "h2", label: "Heading 2" },
  { kind: "h3", label: "Heading 3" },
  { kind: "bullet", label: "Bulleted list" },
  { kind: "ordered", label: "Numbered list" },
  { kind: "task", label: "Checklist" },
  { kind: "quote", label: "Quote" },
  { kind: "callout", label: "Callout" },
  { kind: "code", label: "Code" },
];

interface BlockMenuProps {
  editor: Editor;
  pos: number;
  anchorEl: HTMLElement;
  /** Re-points the handles at a position in the post-action document. */
  reaim: (pos: number) => void;
  onClose: () => void;
}

/** The popover behind the block grip: turn the block into another kind, or act on it. */
export function BlockMenu({ editor, pos, anchorEl, reaim, onClose }: BlockMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const current = blockKindAt(editor.state, pos);

  const close = useCallback(() => {
    anchorEl.focus();
    onClose();
  }, [anchorEl, onClose]);

  // Position against the grip, then hand focus to the first item.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    let live = true;
    void computePosition(anchorEl, el, { placement: "right-start", middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
      if (!live) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
    el.querySelector<HTMLElement>("[data-menu-item]")?.focus();
    return () => {
      live = false;
    };
  }, [anchorEl]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const node = event.target as Node;
      if (menuRef.current?.contains(node) || anchorEl.contains(node)) return;
      onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [anchorEl, onClose]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const el = menuRef.current;
    if (!el) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const items = [...el.querySelectorAll<HTMLElement>("[data-menu-item]")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = (delta: number) => {
      event.preventDefault();
      items[(index + delta + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") step(1);
    else if (event.key === "ArrowUp") step(-1);
    else if (event.key === "Tab") step(event.shiftKey ? -1 : 1);
  }

  /**
   * Every action works on the block at `pos`, then closes and hands focus back. Each of them
   * moves, replaces or removes that block, so `pos` is stale the moment the action returns:
   * re-aim the handles from the selection the action left behind before closing. Focus is on
   * the grip, not the editor, so `BlockHandles`' own `selectionUpdate` listener bails out and
   * cannot do this. After a delete that emptied the document the selection sits in the fresh
   * empty paragraph, so the handles land there rather than on nothing.
   */
  function run(action: () => void) {
    action();
    reaim(editor.state.selection.from);
    close();
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Block options"
      onKeyDown={onKeyDown}
      className="panel rounded-md p-1 w-64 z-50 absolute top-0 left-0 motion-safe:animate-[fade-in_120ms_ease-out]"
    >
      {/* Tables, images and rules have no kind of their own: there is nothing to turn them into. */}
      {current && (
        <>
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-fg-faint">Turn into</p>
          <div role="group" aria-label="Turn into" className="flex flex-wrap gap-1 px-1 pb-1.5">
            {BLOCK_KINDS.map(({ kind, label }) => (
              <Chip key={kind} role="menuitemradio" aria-checked={current === kind} active={current === kind} data-menu-item onClick={() => run(() => turnInto(editor, pos, kind))}>
                {label}
              </Chip>
            ))}
          </div>
        </>
      )}
      <div className={current ? "border-t border-hairline pt-1" : ""}>
        <MenuItem icon={Copy} label="Duplicate" onSelect={() => run(() => void duplicateBlock(editor, pos))} />
        <MenuItem
          icon={ArrowUp}
          label="Move up"
          onSelect={() =>
            run(() => {
              editor.commands.setTextSelection(pos + 1);
              moveBlock(editor, "up");
            })
          }
        />
        <MenuItem
          icon={ArrowDown}
          label="Move down"
          onSelect={() =>
            run(() => {
              editor.commands.setTextSelection(pos + 1);
              moveBlock(editor, "down");
            })
          }
        />
        <MenuItem icon={Trash2} label="Delete" danger onSelect={() => run(() => void deleteBlock(editor, pos))} />
      </div>
    </div>,
    document.body,
  );
}

function MenuItem({ icon: Icon, label, danger = false, onSelect }: { icon: LucideIcon; label: string; danger?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      onClick={onSelect}
      className={`focus-ring w-full flex items-center gap-2.5 px-2 h-9 rounded-sm text-left text-[13px] transition-colors duration-100 ${
        danger ? "text-danger hover:bg-danger/10" : "text-fg-muted hover:text-fg hover:bg-layer-2"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
