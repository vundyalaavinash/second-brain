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

const HTML_BLOCK_START = /^<\/?[a-zA-Z][^>]*>/;

/**
 * Wrap raw HTML blocks in an ```html fence so nothing is dropped. A block is a run of
 * non-blank lines outside any existing fence whose first line starts with a tag.
 * Fence state is tracked line by line so a fence anywhere earlier in the document
 * cannot leak into (or block wrapping of) content that follows it.
 */
export function prepareMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let block: string[] = [];

  const flushBlock = () => {
    if (block.length === 0) return;
    const firstLine = block[0].trim();
    if (HTML_BLOCK_START.test(firstLine) && !/^<https?:/.test(firstLine)) {
      out.push("```html", ...block, "```");
    } else {
      out.push(...block);
    }
    block = [];
  };

  for (const line of lines) {
    const isFenceMarker = line.trim().startsWith("```");
    if (isFenceMarker) {
      flushBlock();
      out.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      flushBlock();
      out.push(line);
      continue;
    }
    block.push(line);
  }
  flushBlock();

  return out.join("\n");
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
        timer.current = undefined;
        const md = editor.getMarkdown();
        if (md === lastMarkdown.current) return;
        lastMarkdown.current = md;
        onChangeRef.current(md);
      }, EMIT_DEBOUNCE_MS);
    },
    onBlur: ({ editor }) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
        const md = editor.getMarkdown();
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
