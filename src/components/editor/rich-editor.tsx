"use client";

import { Component, useCallback, useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { buildExtensions } from "./extensions";
import { EditorBubbleMenu } from "./bubble-menu";
import { BlockHandles } from "./block-handles";
import { IMAGE_MIMES, handleFiles } from "./images";
import { ItemIdProvider } from "./upload-failed";
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

export function RichEditorInner({ value, onChange, onBlur, placeholder, autofocus, className = "", itemId, onReady }: RichEditorProps) {
  const lastMarkdown = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const editorRef = useRef<Editor | null>(null);
  const itemIdRef = useRef(itemId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    itemIdRef.current = itemId;
  }, [itemId]);

  /** Flush a pending debounced emission immediately: used by ⌘S and unmount so neither
   * loses the trailing edit the 300ms debounce hasn't emitted yet. */
  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    const md = editorRef.current?.getMarkdown();
    if (md === undefined || md === lastMarkdown.current) return;
    lastMarkdown.current = md;
    onChangeRef.current(md);
  }, []);

  const editor = useEditor({
    extensions: buildExtensions({ placeholder }),
    content: prepareMarkdown(value),
    contentType: "markdown",
    autofocus: autofocus ? "end" : false,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: `doc rich-editor ${className}`, spellcheck: "true" },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return false;
        event.preventDefault();
        return handleFiles(editorRef.current!, files, itemIdRef.current);
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) editorRef.current?.commands.setTextSelection(coords.pos);
        return handleFiles(editorRef.current!, files, itemIdRef.current);
      },
    },
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
    editorRef.current = editor ?? null;
  }, [editor]);

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // The slash menu's "Image" item asks the editor to open the file picker.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onPickImage = () => fileInputRef.current?.click();
    dom.addEventListener("sb:pick-image", onPickImage);
    return () => dom.removeEventListener("sb:pick-image", onPickImage);
  }, [editor]);

  // External value changes (for example a poll refreshing the item) replace the content without emitting.
  useEffect(() => {
    if (!editor || value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    editor.chain().setMeta("external", true).setContent(prepareMarkdown(value), { contentType: "markdown", emitUpdate: false }).run();
  }, [editor, value]);

  // Capture phase so this runs before the hosts' own ⌘S keydown listeners (bubble phase),
  // flushing a pending debounced emission so the host's save reads the latest markdown.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") flush();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [flush]);

  useEffect(() => () => flush(), [flush]);

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (editor && files.length) handleFiles(editor, files, itemId);
  }

  if (!editor) return <div className={`doc rich-editor ${className}`} aria-busy="true" />;
  return (
    <ItemIdProvider itemId={itemId}>
      <div ref={containerRef} className="relative group">
        <EditorContent editor={editor} />
        <BlockHandles editor={editor} containerRef={containerRef} />
      </div>
      <EditorBubbleMenu editor={editor} />
      <input ref={fileInputRef} type="file" accept={IMAGE_MIMES.join(",")} className="hidden" aria-hidden tabIndex={-1} onChange={onFileInputChange} />
    </ItemIdProvider>
  );
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
