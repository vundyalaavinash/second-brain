import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";

export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote" | "callout" | "code";

/** The depth-1 block containing `pos`, with its start and end positions in the document. */
export function topLevelBlockAt(state: EditorState, pos: number): { node: PMNode; pos: number; end: number } | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  if ($pos.depth === 0) {
    const index = $pos.index(0);
    if (index >= state.doc.childCount) return null;
    const node = state.doc.child(index);
    const start = $pos.posAtIndex(index, 0);
    return { node, pos: start, end: start + node.nodeSize };
  }
  const node = $pos.node(1);
  const start = $pos.before(1);
  return { node, pos: start, end: start + node.nodeSize };
}

/**
 * Swaps the block holding the selection with its neighbour, writing into `tr`. Kept
 * separate from `moveBlock` so TipTap commands can contribute to their own transaction
 * instead of dispatching a second, mismatched one.
 */
export function applyBlockMove(state: EditorState, tr: Transaction, dir: "up" | "down"): boolean {
  const block = topLevelBlockAt(state, state.selection.from);
  if (!block) return false;
  const index = state.doc.resolve(block.pos).index(0);
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.doc.childCount) return false;
  const other = state.doc.child(target);
  // Delete first, then insert on the far side of the neighbour; the insert position is
  // expressed in the post-delete document.
  const newPos = dir === "up" ? block.pos - other.nodeSize : block.pos + other.nodeSize;
  tr.delete(block.pos, block.end).insert(newPos, block.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + 1)));
  return true;
}

export function moveBlock(editor: Editor, dir: "up" | "down"): boolean {
  const tr = editor.state.tr;
  if (!applyBlockMove(editor.state, tr, dir)) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateBlock(editor: Editor, pos: number): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  if (!block) return false;
  editor.view.dispatch(editor.state.tr.insert(block.end, block.node.copy(block.node.content)));
  return true;
}

export function deleteBlock(editor: Editor, pos: number): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  if (!block) return false;
  const tr = editor.state.tr.delete(block.pos, block.end);
  if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr);
  return true;
}

/**
 * Hands the block to ProseMirror as a move drag so its own drop handling performs the
 * move. Lives here rather than in the handle component because assigning to
 * `view.dragging` is a mutation the React compiler will not allow inside a component.
 */
export function startBlockDrag(editor: Editor, block: { node: PMNode; pos: number }, dataTransfer: DataTransfer): void {
  editor.commands.setNodeSelection(block.pos);
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData("text/html", "");
  editor.view.dragging = { slice: new Slice(Fragment.from(block.node), 0, 0), move: true };
}

/**
 * Clears the drag ProseMirror is holding. The grip lives outside `view.dom`, so
 * ProseMirror's own `dragend` never fires for it: without this a cancelled drag would
 * leave a stale slice that the next drop into the editor would paste, deleting the
 * selection on the way.
 */
export function endBlockDrag(editor: Editor): void {
  editor.view.dragging = null;
}

const CALLOUT_MARKER = /^\[!(?:note|tip|warning)\]\s?/i;

/** The inline content of a block: the textblock itself, or the textblocks it wraps. */
function inlineContent(node: PMNode): Fragment {
  if (node.isTextblock) return node.content;
  let frag = Fragment.empty;
  node.descendants((n) => {
    if (n.isTextblock) {
      frag = frag.append(n.content);
      return false;
    }
    return true;
  });
  return frag;
}

/** Drops a leading `[!note] ` so turning a callout into something else does not keep the marker. */
function stripCalloutMarker(frag: Fragment): Fragment {
  const first = frag.firstChild;
  if (!first?.isText || !first.text) return frag;
  const m = CALLOUT_MARKER.exec(first.text);
  return m ? frag.cut(m[0].length) : frag;
}

/** Replaces the block at `pos` with `kind`, preserving its inline content. */
export function turnInto(editor: Editor, pos: number, kind: BlockKind): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  // Blocks with no kind of their own (tables, images, rules) have no inline content to
  // carry over; converting one would flatten it into a single line of text.
  if (!block || !blockKindAt(editor.state, pos)) return false;
  const { schema } = editor;
  const content = stripCalloutMarker(inlineContent(block.node));
  const para = (frag: Fragment) => schema.nodes.paragraph.create(null, frag);
  let next: PMNode;
  switch (kind) {
    case "paragraph": next = para(content); break;
    case "h1": next = schema.nodes.heading.create({ level: 1 }, content); break;
    case "h2": next = schema.nodes.heading.create({ level: 2 }, content); break;
    case "h3": next = schema.nodes.heading.create({ level: 3 }, content); break;
    case "bullet": next = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, para(content))); break;
    case "ordered": next = schema.nodes.orderedList.create(null, schema.nodes.listItem.create(null, para(content))); break;
    case "task": next = schema.nodes.taskList.create(null, schema.nodes.taskItem.create({ checked: false }, para(content))); break;
    case "quote": next = schema.nodes.blockquote.create(null, para(content)); break;
    case "callout": next = schema.nodes.blockquote.create(null, para(Fragment.from(schema.text("[!note] ")).append(content))); break;
    case "code": next = schema.nodes.codeBlock.create(null, content.size ? schema.text(content.textBetween(0, content.size, "\n")) : undefined); break;
  }
  editor.view.dispatch(editor.state.tr.replaceWith(block.pos, block.end, next));
  return true;
}

/** The kind the block at `pos` already is, for marking the current chip in the block menu. */
export function blockKindAt(state: EditorState, pos: number): BlockKind | null {
  const block = topLevelBlockAt(state, pos);
  if (!block) return null;
  const { node } = block;
  switch (node.type.name) {
    case "heading": {
      const level = node.attrs.level as number;
      return level === 1 ? "h1" : level === 2 ? "h2" : "h3";
    }
    case "bulletList": return "bullet";
    case "orderedList": return "ordered";
    case "taskList": return "task";
    case "codeBlock": return "code";
    case "blockquote":
      return CALLOUT_MARKER.test(node.firstChild?.textContent ?? "") ? "callout" : "quote";
    case "paragraph": return "paragraph";
    default: return null;
  }
}
