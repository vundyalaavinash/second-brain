import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Paragraph } from "@tiptap/extension-paragraph";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Callout } from "./callout";
import { UploadFailed } from "./upload-failed";
import { SlashCommand } from "./slash-menu";

const lowlight = createLowlight(common);

/** Paragraph extended with an `uploadId` attribute: an unrendered marker so
 * `insertImageWithUpload` can find and replace its own placeholder paragraph. */
const UploadParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: { default: null, rendered: false },
    };
  },
});

export function buildExtensions(opts: { placeholder?: string }): Extensions {
  return [
    StarterKit.configure({
      paragraph: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
      heading: { levels: [1, 2, 3] },
    }),
    UploadParagraph,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: false }),
    Placeholder.configure({ placeholder: opts.placeholder ?? "Write, or press / for blocks" }),
    Markdown,
    Callout,
    UploadFailed,
    SlashCommand,
  ];
}
