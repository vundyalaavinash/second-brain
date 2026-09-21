// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { moveBlock, turnInto, duplicateBlock, deleteBlock, topLevelBlockAt, blockKindAt, startBlockDrag, endBlockDrag, type BlockKind } from "./block-utils";

function make(md: string): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: buildExtensions({}), content: md, contentType: "markdown" });
}

// StarterKit's trailing-node extension appends an empty paragraph after a document that
// ends in a non-paragraph block, so markdown for those cases ends in a blank line.
describe("block utils", () => {
  it("moves the current block up and down", () => {
    const e = make("One\n\nTwo\n\nThree\n");
    e.commands.setTextSelection(6); // inside "Two"
    expect(moveBlock(e, "up")).toBe(true);
    expect(e.getMarkdown()).toBe("Two\n\nOne\n\nThree");
    expect(moveBlock(e, "down")).toBe(true);
    expect(moveBlock(e, "down")).toBe(true);
    expect(e.getMarkdown()).toBe("One\n\nThree\n\nTwo");
    expect(moveBlock(e, "down")).toBe(false);
  });
  it("turns a paragraph into a heading, list, checklist, quote, callout, and back", () => {
    const e = make("Hello **there**\n");
    const b = topLevelBlockAt(e.state, 1)!;
    expect(turnInto(e, b.pos, "h2")).toBe(true);
    expect(e.getMarkdown()).toBe("## Hello **there**\n\n");
    expect(turnInto(e, 1, "task")).toBe(true);
    expect(e.getMarkdown()).toBe("- [ ] Hello **there**\n\n");
    expect(turnInto(e, 1, "callout")).toBe(true);
    expect(e.getMarkdown()).toBe("> \\[!note\\] Hello **there**\n\n");
    expect(turnInto(e, 1, "paragraph")).toBe(true);
    expect(e.getMarkdown()).toBe("Hello **there**\n\n");
  });
  it("names the kind of every top-level block", () => {
    const e = make("# Title\n\n- [ ] Task\n\n> [!note] Heads up\n\n> Plain quote\n\nText\n");
    const kinds: (BlockKind | null)[] = [];
    e.state.doc.forEach((_node, offset) => kinds.push(blockKindAt(e.state, offset + 1)));
    expect(kinds).toEqual(["h1", "task", "callout", "quote", "paragraph"]);
  });
  it("refuses to turn a block that has no kind of its own into something else", () => {
    const e = make("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    const before = e.getMarkdown();
    expect(topLevelBlockAt(e.state, 1)!.node.type.name).toBe("table");
    expect(blockKindAt(e.state, 1)).toBe(null);
    expect(turnInto(e, 1, "h2")).toBe(false);
    expect(e.getMarkdown()).toBe(before);
  });
  it("clears the drag ProseMirror is holding once the drag ends", () => {
    const e = make("A\n\nB\n");
    const block = topLevelBlockAt(e.state, 1)!;
    const dataTransfer = { effectAllowed: "", setData: () => {} } as unknown as DataTransfer;
    startBlockDrag(e, block, dataTransfer);
    expect(e.view.dragging).not.toBeNull();
    endBlockDrag(e);
    expect(e.view.dragging).toBeNull();
  });
  it("duplicates and deletes", () => {
    const e = make("A\n\nB\n");
    expect(duplicateBlock(e, 1)).toBe(true);
    expect(e.getMarkdown()).toBe("A\n\nA\n\nB");
    expect(deleteBlock(e, 1)).toBe(true);
    expect(e.getMarkdown()).toBe("A\n\nB");
  });
});
