// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";

function make(md: string): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: buildExtensions({}), content: md, contentType: "markdown" });
}
// jsdom reports an empty `navigator.platform`, so TipTap resolves `Mod-` to Ctrl, not Meta.
function key(e: Editor, k: string, mods: Partial<KeyboardEventInit> = {}) {
  e.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
}

describe("block keymap", () => {
  it("Mod+ArrowDown moves the block", () => {
    const e = make("One\n\nTwo\n");
    e.commands.setTextSelection(1);
    key(e, "ArrowDown", { ctrlKey: true });
    expect(e.getMarkdown()).toBe("Two\n\nOne");
  });
  it("Mod+Shift+/ asks for the block menu at the caret", () => {
    const e = make("One\n\nTwo\n");
    e.commands.setTextSelection(7);
    const seen: number[] = [];
    e.view.dom.addEventListener("sb:block-menu", (event) => seen.push((event as CustomEvent<{ pos: number }>).detail.pos));
    key(e, "/", { ctrlKey: true, shiftKey: true });
    expect(seen).toEqual([7]);
  });
  it("Backspace at the start of a heading makes it a paragraph", () => {
    const e = make("## Title\n");
    e.commands.setTextSelection(1);
    key(e, "Backspace");
    expect(e.getMarkdown()).toBe("Title\n\n");
  });
  it("Enter at the end of a heading starts a paragraph", () => {
    const e = make("## Title\n");
    e.commands.setTextSelection(7);
    key(e, "Enter");
    e.commands.insertContent("Body");
    expect(e.getMarkdown()).toBe("## Title\n\nBody\n\n");
  });
});
