import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const MARKER = /^\[!(note|tip|warning)\]/i;

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return true;
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph") return false;
    const m = MARKER.exec(first.textContent);
    if (!m) return false;
    const kind = m[1].toLowerCase();
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${kind}` }));
    const from = pos + 2; // blockquote open + paragraph open
    decos.push(Decoration.inline(from, from + m[0].length, { class: "callout-marker", "data-kind": kind }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** Styles `> [!note]`-style blockquotes as callouts without changing the markdown. */
export const Callout = Extension.create({
  name: "callout",
  addProseMirrorPlugins() {
    const key = new PluginKey("callout");
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});
