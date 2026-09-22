"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { GripVertical, Plus } from "lucide-react";
import { BLOCK_MENU_EVENT } from "./block-keymap";
import { BlockMenu } from "./block-menu";
import { endBlockDrag, startBlockDrag, topLevelBlockAt } from "./block-utils";

interface Target {
  pos: number;
  top: number;
}

/**
 * The gutter controls beside the block under the pointer (or the caret): add a block, and
 * open the block menu. Lives in the editor wrapper's left padding, not in the document, so
 * the markdown is untouched.
 */
export function BlockHandles({ editor, containerRef }: { editor: Editor; containerRef: RefObject<HTMLDivElement | null> }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const menuOpenRef = useRef(false);

  useEffect(() => {
    menuOpenRef.current = menuAnchor !== null;
  }, [menuAnchor]);

  /**
   * Points the handles at the block containing `pos`. Declared here rather than inside the
   * effect because the block menu calls it too: an action that moves blocks about leaves the
   * handles aimed at where the block used to be, and the grip holds focus at the time, so
   * `onSelection` cannot do it.
   */
  const aim = useCallback(
    (pos: number) => {
      const container = containerRef.current;
      if (!container) return;
      const block = topLevelBlockAt(editor.state, pos);
      if (!block) return;
      let top: number;
      try {
        top = editor.view.coordsAtPos(block.pos + 1).top - container.getBoundingClientRect().top;
      } catch {
        return;
      }
      setTarget((prev) => (prev && prev.pos === block.pos && prev.top === top ? prev : { pos: block.pos, top }));
    },
    [editor, containerRef],
  );

  useEffect(() => {
    const dom = editor.view.dom;
    const container = containerRef.current;

    function onMouseMove(event: MouseEvent) {
      if (menuOpenRef.current) return;
      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!coords) return;
      aim(coords.inside >= 0 ? coords.inside : coords.pos);
    }

    function onMouseLeave() {
      if (menuOpenRef.current) return;
      setTarget(null);
    }

    function onSelection() {
      if (!editor.isFocused) return;
      aim(editor.state.selection.from);
    }

    function onMenuRequest(event: Event) {
      const pos = (event as CustomEvent<{ pos: number }>).detail?.pos ?? editor.state.selection.from;
      aim(pos);
      setMenuAnchor(gripRef.current);
      gripRef.current?.focus();
    }

    dom.addEventListener("mousemove", onMouseMove);
    // On the wrapper, not the editor: moving the pointer from the text to a handle leaves
    // the editor DOM, and the handles must not jump away underneath the pointer.
    container?.addEventListener("mouseleave", onMouseLeave);
    dom.addEventListener(BLOCK_MENU_EVENT, onMenuRequest);
    editor.on("selectionUpdate", onSelection);
    return () => {
      dom.removeEventListener("mousemove", onMouseMove);
      container?.removeEventListener("mouseleave", onMouseLeave);
      dom.removeEventListener(BLOCK_MENU_EVENT, onMenuRequest);
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor, containerRef, aim]);

  // Before the first hover or caret move the handles still sit at the first block, so they
  // are always reachable by Tab.
  const pos = target?.pos ?? 0;
  const top = target?.top ?? 0;

  /** Opens the slash menu in a fresh paragraph after this block. */
  function addBlock() {
    const block = topLevelBlockAt(editor.state, pos);
    if (!block) return;
    const tr = editor.state.tr.insert(block.end, editor.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(block.end + 1)));
    editor.view.dispatch(tr);
    editor.chain().focus().insertContent("/").run();
  }

  /** Hands the block to ProseMirror as a move drag, so the drop lands as a block move. */
  function onDragStart(event: React.DragEvent<HTMLButtonElement>) {
    const block = topLevelBlockAt(editor.state, pos);
    if (block) startBlockDrag(editor, block, event.dataTransfer);
  }

  return (
    <>
      <div
        className="block-handles absolute z-10 flex items-start opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity motion-safe:duration-150"
        style={{ top }}
      >
        <button
          type="button"
          aria-label="Add block"
          title="Add block"
          onClick={addBlock}
          className="focus-ring inline-flex items-center justify-center w-6 h-6 rounded-sm text-fg-faint hover:text-fg hover:bg-layer-2 transition-colors duration-150"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
        <button
          ref={gripRef}
          type="button"
          aria-label="Block options"
          title="Block options"
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== null}
          draggable
          onDragStart={onDragStart}
          onDragEnd={() => endBlockDrag(editor)}
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
          className="focus-ring inline-flex items-center justify-center w-6 h-6 rounded-sm text-fg-faint hover:text-fg hover:bg-layer-2 cursor-grab transition-colors duration-150"
        >
          <GripVertical className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {menuAnchor && <BlockMenu editor={editor} pos={pos} anchorEl={menuAnchor} reaim={aim} onClose={() => setMenuAnchor(null)} />}
    </>
  );
}
