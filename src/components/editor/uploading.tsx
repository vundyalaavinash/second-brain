"use client";

import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

function UploadingView() {
  return (
    <NodeViewWrapper>
      <p className="text-fg-faint text-[13px]">Uploading image</p>
    </NodeViewWrapper>
  );
}

/** Placeholder block shown while an image upload is in flight. An atom node (not a
 * paragraph) so it can never be typed into, and `renderMarkdown` returns "" so a note
 * saved mid-upload never persists the placeholder text. */
export const Uploading = Node.create({
  name: "uploading",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      uploadId: { default: null, rendered: false },
      name: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-uploading]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-uploading": "", ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(UploadingView);
  },
  renderMarkdown: () => "",
});
