"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Italic, Code, Strikethrough, Link2 } from "lucide-react";
import { IconButton, Input } from "../ui";

export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  function applyLink() {
    const href = linkValue.trim();
    if (href) editor.chain().focus().setLink({ href }).run();
    else editor.chain().focus().unsetLink().run();
    setLinkOpen(false);
  }

  return (
    <BubbleMenu editor={editor} shouldShow={({ editor, from, to }) => from !== to && !editor.isActive("codeBlock")} options={{ placement: "top", offset: 8 }}>
      <div className="panel rounded-md p-1 flex items-center gap-0.5">
        <IconButton label="Bold" icon={Bold} active={editor.isActive("bold")} aria-pressed={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <IconButton label="Italic" icon={Italic} active={editor.isActive("italic")} aria-pressed={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <IconButton label="Code" icon={Code} active={editor.isActive("code")} aria-pressed={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
        <IconButton label="Strikethrough" icon={Strikethrough} active={editor.isActive("strike")} aria-pressed={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <IconButton
          label="Link"
          icon={Link2}
          active={editor.isActive("link") || linkOpen}
          onClick={() => {
            if (!linkOpen) setLinkValue((editor.getAttributes("link").href as string | undefined) ?? "");
            setLinkOpen((v) => !v);
          }}
        />
        {linkOpen && (
          <Input
            size="sm"
            autoFocus
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                setLinkOpen(false);
              }
            }}
            placeholder="Paste a link"
            className="w-40 ml-0.5"
          />
        )}
      </div>
    </BubbleMenu>
  );
}
