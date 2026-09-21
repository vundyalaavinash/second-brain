import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { applyBlockMove } from "./block-utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockKeymap: {
      /** Swap the top-level block holding the selection with the one above it. */
      moveBlockUp: () => ReturnType;
      /** Swap the top-level block holding the selection with the one below it. */
      moveBlockDown: () => ReturnType;
    };
  }
}

/** Shared by the two move commands: only touches `tr` when the command really runs. */
function move(state: EditorState, tr: Transaction, dispatch: (() => void) | undefined, dir: "up" | "down"): boolean {
  if (!dispatch) return applyBlockMove(state, state.tr, dir);
  const moved = applyBlockMove(state, tr, dir);
  if (moved) tr.scrollIntoView();
  return moved;
}

/** The event `BlockHandles` listens for to open the block menu from the keyboard. */
export const BLOCK_MENU_EVENT = "sb:block-menu";

export const BlockKeymap = Extension.create({
  name: "blockKeymap",

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, tr, dispatch }) =>
          move(state, tr, dispatch, "up"),
      moveBlockDown:
        () =>
        ({ state, tr, dispatch }) =>
          move(state, tr, dispatch, "down"),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-ArrowUp": () => this.editor.commands.moveBlockUp(),
      "Mod-ArrowDown": () => this.editor.commands.moveBlockDown(),
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "heading") return false;
        return this.editor.commands.setParagraph();
      },
      "Mod-Shift-/": () => {
        this.editor.view.dom.dispatchEvent(new CustomEvent(BLOCK_MENU_EVENT, { detail: { pos: this.editor.state.selection.from } }));
        return true;
      },
    };
  },
});
