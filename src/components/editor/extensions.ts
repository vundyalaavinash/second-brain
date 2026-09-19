import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import cssLang from "highlight.js/lib/languages/css";
import bashLang from "highlight.js/lib/languages/bash";
import goLang from "highlight.js/lib/languages/go";
import jsonLang from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import pythonLang from "highlight.js/lib/languages/python";
import rustLang from "highlight.js/lib/languages/rust";
import sqlLang from "highlight.js/lib/languages/sql";
import swiftLang from "highlight.js/lib/languages/swift";
import xmlLang from "highlight.js/lib/languages/xml";
import yamlLang from "highlight.js/lib/languages/yaml";
import javascriptLang from "highlight.js/lib/languages/javascript";
import typescriptLang from "highlight.js/lib/languages/typescript";
import { Callout } from "./callout";
import { UploadFailed } from "./upload-failed";
import { Uploading } from "./uploading";
import { SlashCommand } from "./slash-menu";

// Trimmed to the languages notes actually use, instead of lowlight's `common` bundle
// (~35 languages), to keep the editor chunk small.
const lowlight = createLowlight();
lowlight.register("typescript", typescriptLang);
lowlight.register("javascript", javascriptLang);
lowlight.register("json", jsonLang);
lowlight.register("bash", bashLang);
lowlight.register("python", pythonLang);
lowlight.register("sql", sqlLang);
lowlight.register("css", cssLang);
lowlight.register("xml", xmlLang);
lowlight.register("markdown", markdownLang);
lowlight.register("yaml", yamlLang);
lowlight.register("go", goLang);
lowlight.register("rust", rustLang);
lowlight.register("swift", swiftLang);

export function buildExtensions(opts: { placeholder?: string }): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
      heading: { levels: [1, 2, 3] },
    }),
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
    Uploading,
    SlashCommand,
  ];
}
