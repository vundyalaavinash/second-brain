"use client";

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Extension, type Editor } from "@tiptap/core";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { computePosition, offset, flip, shift, type VirtualElement } from "@floating-ui/dom";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Table,
  Image as ImageIcon,
  Info,
  Minus,
  type LucideIcon,
} from "lucide-react";

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "heading1", label: "Heading 1", hint: "Large section heading", icon: Heading1, run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
  { id: "heading2", label: "Heading 2", hint: "Medium section heading", icon: Heading2, run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
  { id: "heading3", label: "Heading 3", hint: "Small section heading", icon: Heading3, run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run() },
  { id: "bulletList", label: "Bulleted list", hint: "Simple bulleted list", icon: List, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "orderedList", label: "Numbered list", hint: "List with numbering", icon: ListOrdered, run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "taskList", label: "Checklist", hint: "Track tasks with checkboxes", icon: ListChecks, run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: "blockquote", label: "Quote", hint: "Capture a quote", icon: Quote, run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "codeBlock", label: "Code", hint: "Code block with syntax highlighting", icon: Code2, run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  {
    id: "table",
    label: "Table",
    hint: "3 by 3 table",
    icon: Table,
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "image",
    label: "Image",
    hint: "Upload an image",
    icon: ImageIcon,
    run: (editor) => editor.view.dom.dispatchEvent(new CustomEvent("sb:pick-image")),
  },
  {
    id: "callout",
    label: "Callout",
    hint: "Highlight important context",
    icon: Info,
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "[!note] " }] }] })
        .run(),
  },
  { id: "divider", label: "Divider", hint: "Visual divider between sections", icon: Minus, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
];

export function filterSlashItems(query: string): typeof SLASH_ITEMS {
  const q = query.trim().toLowerCase();
  return SLASH_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
}

interface SlashMenuProps {
  items: SlashItem[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashItem) => void;
}

export function SlashMenu({ items, selectedIndex, onHover, onSelect }: SlashMenuProps) {
  if (items.length === 0) {
    return <p className="px-2 py-1.5 text-[12.5px] text-fg-faint">No blocks match</p>;
  }
  return (
    <div role="listbox" aria-label="Blocks">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelect(item)}
          className={`w-full flex items-center gap-2.5 px-2 h-9 rounded-sm text-left transition-colors duration-100 ${
            i === selectedIndex ? "bg-surface-3 text-fg" : "text-fg-muted"
          }`}
        >
          <item.icon className="w-4 h-4 shrink-0" aria-hidden />
          <span className="shrink-0 text-[13px]">{item.label}</span>
          <span className="flex-1 min-w-0 truncate text-fg-faint text-[11.5px]">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let root: Root | null = null;
          let el: HTMLDivElement | null = null;
          let selectedIndex = 0;
          let currentItems: SlashItem[] = [];
          let currentProps: SuggestionProps<SlashItem, SlashItem> | null = null;

          const renderMenu = () => {
            if (!root) return;
            root.render(
              createElement(SlashMenu, {
                items: currentItems,
                selectedIndex,
                onHover: (i: number) => {
                  selectedIndex = i;
                  renderMenu();
                },
                onSelect: (item: SlashItem) => currentProps?.command(item),
              }),
            );
          };

          const updatePosition = (props: SuggestionProps<SlashItem, SlashItem>) => {
            if (!el) return;
            const rect = props.clientRect?.();
            if (!rect) return;
            const virtualEl: VirtualElement = { getBoundingClientRect: () => rect };
            void computePosition(virtualEl, el, { placement: "bottom-start", middleware: [offset(6), flip(), shift()] }).then(({ x, y }) => {
              if (!el) return;
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
            });
          };

          return {
            onStart: (props) => {
              currentProps = props;
              currentItems = props.items;
              selectedIndex = 0;
              el = document.createElement("div");
              el.className = "panel rounded-md p-1 w-72 z-50";
              el.style.position = "absolute";
              el.style.left = "0px";
              el.style.top = "0px";
              document.body.appendChild(el);
              root = createRoot(el);
              renderMenu();
              updatePosition(props);
            },
            onUpdate: (props) => {
              currentProps = props;
              currentItems = props.items;
              selectedIndex = 0;
              renderMenu();
              updatePosition(props);
            },
            onKeyDown: ({ event }) => {
              if (currentItems.length === 0 && event.key !== "Escape") return false;
              if (event.key === "ArrowDown") {
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderMenu();
                return true;
              }
              if (event.key === "ArrowUp") {
                selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
                renderMenu();
                return true;
              }
              if (event.key === "Enter") {
                const item = currentItems[selectedIndex];
                if (item) currentProps?.command(item);
                return true;
              }
              if (event.key === "Escape") {
                return true;
              }
              return false;
            },
            onExit: () => {
              root?.unmount();
              el?.remove();
              root = null;
              el = null;
              currentProps = null;
              currentItems = [];
            },
          };
        },
      }),
    ];
  },
});
