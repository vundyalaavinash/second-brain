"use client";

import { createContext, useContext, useRef, type ChangeEvent, type ReactNode } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Button } from "../ui";
import { insertImageWithUpload } from "./images";

/** Carries the note's item id (once it has one) down to node views, which render in the
 * same React tree as `EditorContent` but outside `RichEditorInner`'s own props/state. */
const ItemIdContext = createContext<number | undefined>(undefined);

export function ItemIdProvider({ itemId, children }: { itemId: number | undefined; children: ReactNode }) {
  return <ItemIdContext.Provider value={itemId}>{children}</ItemIdContext.Provider>;
}

function UploadFailedView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemId = useContext(ItemIdContext);
  const name = node.attrs.name as string;
  const reason = node.attrs.reason as string;

  function retry() {
    inputRef.current?.click();
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const pos = typeof getPos === "function" ? getPos() : undefined;
    deleteNode();
    if (typeof pos === "number") editor.chain().setTextSelection(pos).run();
    insertImageWithUpload(editor, file, itemId);
  }

  return (
    <NodeViewWrapper className="flex items-center gap-2 py-1">
      <span className="text-danger text-[13px]">
        Image upload failed: {reason}
      </span>
      <Button size="sm" variant="secondary" onClick={retry}>
        Retry
      </Button>
      <Button size="sm" variant="ghost" onClick={deleteNode}>
        Remove
      </Button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" aria-label={`Retry uploading ${name}`} onChange={onFileChosen} />
    </NodeViewWrapper>
  );
}

export const UploadFailed = Node.create({
  name: "uploadFailed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      name: { default: "" },
      reason: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-upload-failed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-upload-failed": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(UploadFailedView);
  },
  // Never write this node into saved markdown: a note saved mid-failure drops
  // the placeholder rather than persisting junk.
  renderMarkdown: () => "",
});
