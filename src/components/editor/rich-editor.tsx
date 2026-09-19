"use client";

import { Component, useEffect, useRef, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { buildExtensions } from "./extensions";
import { Textarea } from "../ui";

export interface RichEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  autofocus?: boolean;
  className?: string;
  itemId?: number;
  onReady?: (editor: Editor) => void;
}

const EMIT_DEBOUNCE_MS = 300;

/**
 * Wrap raw HTML blocks in an ```html fence so nothing is dropped. A block is a paragraph that starts with a tag.
 */
export function prepareMarkdown(md: string): string {
  const inFence = { on: false };
  return md
    .split("\n\n")
    .map((block) => {
      if (block.trim().startsWith("```")) inFence.on = !inFence.on || !block.trim().endsWith("```");
      if (!inFence.on && /^<\/?[a-zA-Z][^>]*>/.test(block.trim()) && !/^<https?:/.test(block.trim())) {
        return "```html\n" + block + "\n```";
      }
      return block;
    })
    .join("\n\n");
}

export function RichEditorInner({ value, onChange, onBlur, placeholder, autofocus, className = "", onReady }: RichEditorProps) {
  const lastMarkdown = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: buildExtensions({ placeholder }),
    content: prepareMarkdown(value),
    contentType: "markdown",
    autofocus: autofocus ? "end" : false,
    immediatelyRender: false,
    editorProps: { attributes: { class: `md rich-editor ${className}`, spellcheck: "true" } },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta("external")) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const md = editor.getMarkdown();
        if (md === lastMarkdown.current) return;
        lastMarkdown.current = md;
        onChangeRef.current(md);
      }, EMIT_DEBOUNCE_MS);
    },
    onBlur: () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
        const md = editor?.getMarkdown() ?? lastMarkdown.current;
        if (md !== lastMarkdown.current) {
          lastMarkdown.current = md;
          onChangeRef.current(md);
        }
      }
      onBlur?.();
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // External value changes (for example a poll refreshing the item) replace the content without emitting.
  useEffect(() => {
    if (!editor || value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    editor.chain().setMeta("external", true).setContent(prepareMarkdown(value), { contentType: "markdown", emitUpdate: false }).run();
  }, [editor, value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!editor) return <div className={`md rich-editor ${className}`} aria-busy="true" />;
  return <EditorContent editor={editor} />;
}

interface BoundaryState { failed: boolean }

export class RichEditorFallback extends Component<RichEditorProps & { children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[rich-editor]", err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const { value, onChange, onBlur, placeholder, className = "" } = this.props;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-warn">Rich editor unavailable, using plain text.</p>
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} className={className} />
      </div>
    );
  }
}

export function RichEditor(props: RichEditorProps) {
  return (
    <RichEditorFallback {...props}>
      <RichEditorInner {...props} />
    </RichEditorFallback>
  );
}
