# Rich Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain markdown textarea with a Notion-style block editor (slash menu, markdown shortcuts, checklists, tables, code, callouts, images, block drag) while every note stays stored as markdown.

**Architecture:** A `RichEditor` client component wraps TipTap 3 with the official `@tiptap/markdown` extension, so `value` in and `onChange` out are markdown strings and nothing downstream changes. Pasted images upload to a new `attachments` table and directory and are referenced by `/api/attachments/<id>`. The item, container, and person editors swap their body textareas for `RichEditor` with no change to their save logic; an error boundary falls back to the textarea.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4; `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-table`, `@tiptap/extension-image`, `@tiptap/extension-placeholder`, `@tiptap/extension-code-block-lowlight`, `@tiptap/suggestion`, `@tiptap/extension-drag-handle-react` (all `3.31.3`), `@floating-ui/dom 1.8.0`, `lowlight 3.3.0`; dev: `jsdom 30.0.1`, `@testing-library/react 16.3.3`; better-sqlite3 + Drizzle; Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-16-activity-and-rich-notes-design.md` section 3 (and the 2026-09-12 spec's architecture and copy rules).

## Global Constraints

- Storage stays markdown: `items.body`, `containers.description`, `containers.next_steps`, and `people.profile` remain markdown text; the editor never writes JSON.
- Behaviour freeze on the host editors: `persist`, `markDirty`, the 800 ms save debounce, blur and unmount flushes, ⌘S, `patchMeta`, status polling, and every `aria-label`, `title`, and `disabled` condition in `item-editor.tsx`, `container-editor.tsx`, and `person-editor.tsx` stay exactly as they are. Only the textarea element is swapped.
- The editor must not emit `onChange` until the user edits; opening and closing a note never rewrites it.
- Every TipTap package is pinned to exactly `3.31.3`; `@tiptap/markdown` is the only markdown bridge (no `tiptap-markdown`).
- Copy rules: sentence case; no uppercase tracked labels; no middle-dot strings; buttons name the action; mono only for ids, counts, timestamps, slugs, shortcut keys, and code.
- Attachments accept only `image/png`, `image/jpeg`, `image/gif`, `image/webp`, at most 20 MB; `image/svg+xml` is rejected with 415.
- Component tests run under jsdom with a `// @vitest-environment jsdom` first line; domain and API tests stay in node.
- Every commit ends with the two trailer lines shown in each commit step. `npm test && npm run lint && npm run build` must be clean at the end of every task. Do not start a server on port 3141.

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts`, `drizzle/0003_*.sql` | `attachments` table |
| `src/lib/paths.ts` | `attachmentsDir()` |
| `src/domain/attachments.ts` | save, get, list, delete-for-item, `AttachmentError` |
| `src/domain/items/index.ts` | `deleteItem` also removes the attachment directory |
| `src/app/api/attachments/route.ts`, `[id]/route.ts` | upload and serve |
| `src/jobs/handlers/backup.ts` | copy `attachments/` next to the database backup |
| `vitest.config.ts` | jsx automatic for tsx tests |
| `src/components/editor/extensions.ts` | the extension list builder (`buildExtensions`) |
| `src/components/editor/callout.ts` | blockquote marker decoration plugin |
| `src/components/editor/slash-menu.tsx` | `/` command menu (suggestion plugin plus React list) |
| `src/components/editor/bubble-menu.tsx` | selection toolbar |
| `src/components/editor/images.ts` | paste and drop handlers, upload with placeholder and retry |
| `src/components/editor/rich-editor.tsx` | `RichEditor` component and `RichEditorFallback` boundary |
| `src/components/editor/editor.css` | editor-only styles (imported by `globals.css`) |
| `src/components/editor/fixtures/*.md` | round-trip corpus |
| `src/components/editor/*.test.tsx` | jsdom tests |

---

### Task 1: Attachments table, domain, API, backup

**Files:**
- Modify: `src/db/schema.ts`, `src/lib/paths.ts`, `src/domain/items/index.ts`, `src/jobs/handlers/backup.ts`, `src/lib/api.ts` (`errorResponse` knows `AttachmentError`)
- Create: `drizzle/0003_attachments.sql` (generated), `src/domain/attachments.ts`, `src/app/api/attachments/route.ts`, `src/app/api/attachments/[id]/route.ts`
- Test: `src/domain/attachments.test.ts`, `src/app/api/attachments.test.ts`, `src/jobs/handlers/backup.test.ts` (one added case)

**Interfaces:**
- Produces:
  - table `attachments` (`id`, `itemId` → items cascade, `filename`, `mime`, `bytes`, `createdAt`), type `Attachment`
  - `attachmentsDir(): string` = `DATA_DIR/attachments`
  - `ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"]`, `MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024`
  - `saveAttachment(db, { itemId, filename, mime, bytes: Buffer }): Attachment` (throws `AttachmentError(415)` on a disallowed mime, `AttachmentError(413)` over the cap, `AttachmentError(404)` when the item does not exist)
  - `getAttachment(db, id): Attachment | undefined`, `attachmentPath(a: Attachment): string`, `listAttachments(db, itemId): Attachment[]`, `deleteItemAttachments(db, itemId): void` (rows go with the item's cascade; this removes the directory)
  - `class AttachmentError extends Error { status }`
  - `POST /api/attachments` multipart `itemId`, `file` → 201 `{ id, url, filename, mime, bytes }`; `GET /api/attachments/[id]` streams the file with `content-type` and `cache-control: private, max-age=31536000, immutable`; 404 when missing.

- [ ] **Step 1: Write the failing domain test**

```ts
// src/domain/attachments.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, deleteItem } from "@/domain/items";
import { saveAttachment, getAttachment, attachmentPath, listAttachments, AttachmentError } from "./attachments";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("attachments", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("saves, serves, lists, and removes with the item", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const a = saveAttachment(t.db, { itemId: item.id, filename: "shot.png", mime: "image/png", bytes: PNG });
    expect(a.itemId).toBe(item.id);
    expect(fs.readFileSync(attachmentPath(a))).toEqual(PNG);
    expect(attachmentPath(a)).toContain(`/attachments/${item.id}/`);
    expect(getAttachment(t.db, a.id)?.filename).toBe("shot.png");
    expect(listAttachments(t.db, item.id)).toHaveLength(1);
    deleteItem(t.db, item.id);
    expect(getAttachment(t.db, a.id)).toBeUndefined();
    expect(fs.existsSync(attachmentPath(a))).toBe(false);
  });

  it("rejects bad mimes, oversize files, and unknown items", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    expect(() => saveAttachment(t.db, { itemId: item.id, filename: "x.svg", mime: "image/svg+xml", bytes: PNG })).toThrow(AttachmentError);
    expect(() => saveAttachment(t.db, { itemId: item.id, filename: "x.png", mime: "image/png", bytes: Buffer.alloc(20 * 1024 * 1024 + 1) })).toThrow(/20 MB/);
    expect(() => saveAttachment(t.db, { itemId: 999, filename: "x.png", mime: "image/png", bytes: PNG })).toThrow(/not found/);
  });

  it("sanitises file names", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const a = saveAttachment(t.db, { itemId: item.id, filename: "../../evil name?.png", mime: "image/png", bytes: PNG });
    expect(attachmentPath(a)).not.toContain("..");
    expect(attachmentPath(a)).toMatch(/evil_name_\.png$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/attachments.test.ts`
Expected: FAIL, cannot find module `./attachments`.

- [ ] **Step 3: Schema, migration, paths, domain**

Append to `src/db/schema.ts`:

```ts
export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("attachments_item_idx").on(t.itemId)],
);
export type Attachment = typeof attachments.$inferSelect;
```

Run `npm run db:generate -- --name attachments`; verify `ON DELETE cascade` is present in `drizzle/0003_attachments.sql` and add it by hand if not.

`src/lib/paths.ts` gains:

```ts
export function attachmentsDir(): string {
  return path.join(dataDir(), "attachments");
}
```

```ts
// src/domain/attachments.ts
import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { attachments, items, type Attachment } from "@/db/schema";
import { attachmentsDir } from "@/lib/paths";
import { nowIso } from "@/lib/time";

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-]+/g, "_").slice(-120);
  return base && base !== "." && base !== ".." ? base : "image";
}

export function attachmentPath(a: Attachment): string {
  return path.join(attachmentsDir(), String(a.itemId), `${a.id}-${a.filename}`);
}

export function saveAttachment(db: DB, input: { itemId: number; filename: string; mime: string; bytes: Buffer }): Attachment {
  if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(input.mime)) throw new AttachmentError("Only PNG, JPEG, GIF, and WebP images can be attached", 415);
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("Images must be 20 MB or smaller", 413);
  if (!db.select({ id: items.id }).from(items).where(eq(items.id, input.itemId)).get()) throw new AttachmentError("Item not found", 404);
  const row = db
    .insert(attachments)
    .values({ itemId: input.itemId, filename: safeName(input.filename), mime: input.mime, bytes: input.bytes.length, createdAt: nowIso() })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  const file = attachmentPath(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.bytes);
  return row;
}

export function getAttachment(db: DB, id: number): Attachment | undefined {
  return db.select().from(attachments).where(eq(attachments.id, id)).get();
}

export function listAttachments(db: DB, itemId: number): Attachment[] {
  return db.select().from(attachments).where(eq(attachments.itemId, itemId)).orderBy(asc(attachments.id)).all();
}

/** Removes the item's attachment directory. Rows are removed by the foreign-key cascade when the item is deleted. */
export function deleteItemAttachments(itemId: number): void {
  fs.rmSync(path.join(attachmentsDir(), String(itemId)), { recursive: true, force: true });
}
```

In `src/domain/items/index.ts`, `deleteItem` calls `deleteItemAttachments(id)` after the transaction (import from `@/domain/attachments`). Watch for an import cycle: `attachments.ts` imports only the schema, not `@/domain/items`, so none exists.

In `src/lib/api.ts` add `AttachmentError` to the `instanceof` chain in `errorResponse`.

- [ ] **Step 4: Run the domain test**

Run: `npx vitest run src/domain/attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing API test**

```ts
// src/app/api/attachments.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { upload: typeof import("./attachments/route"); file: typeof import("./attachments/[id]/route"); items: typeof import("./items/route") };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function multipart(itemId: number, name: string, mime: string, bytes: Buffer): Request {
  const form = new FormData();
  form.set("itemId", String(itemId));
  form.set("file", new File([bytes], name, { type: mime }));
  return new Request("http://localhost/api/attachments", { method: "POST", body: form });
}
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { upload: await import("./attachments/route"), file: await import("./attachments/[id]/route"), items: await import("./items/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("attachments api", () => {
  it("uploads, serves, and rejects", async () => {
    const created = await r.items.POST(new Request("http://localhost/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "note", title: "n", body: "" }) }));
    const item = (await created.json()) as { id: number };
    const up = await r.upload.POST(multipart(item.id, "shot.png", "image/png", PNG));
    expect(up.status).toBe(201);
    const a = (await up.json()) as { id: number; url: string; mime: string };
    expect(a.url).toBe(`/api/attachments/${a.id}`);
    const got = await r.file.GET(new Request("http://localhost" + a.url), params(a.id));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PNG);
    expect((await r.upload.POST(multipart(item.id, "x.svg", "image/svg+xml", PNG))).status).toBe(415);
    expect((await r.upload.POST(multipart(999, "x.png", "image/png", PNG))).status).toBe(404);
    expect((await r.file.GET(new Request("http://localhost/api/attachments/999"), params(999))).status).toBe(404);
    const missing = await r.upload.POST(new Request("http://localhost/api/attachments", { method: "POST", body: new FormData() }));
    expect(missing.status).toBe(400);
  });
});
```

If `src/app/api/items/route.ts` does not accept a JSON note body in that shape, use `captureNote` from `@/domain/items/capture` with `getDb()` to create the item instead; the assertion is on attachments, not capture.

- [ ] **Step 6: Routes**

```ts
// src/app/api/attachments/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { saveAttachment } from "@/domain/attachments";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const itemRaw = form.get("itemId");
    if (!(file instanceof File) || typeof itemRaw !== "string") return NextResponse.json({ error: "Missing itemId or file field" }, { status: 400 });
    const itemId = parseId(itemRaw);
    const bytes = Buffer.from(await file.arrayBuffer());
    const a = saveAttachment(getDb(), { itemId, filename: file.name || "image", mime: file.type, bytes });
    return NextResponse.json({ id: a.id, url: `/api/attachments/${a.id}`, filename: a.filename, mime: a.mime, bytes: a.bytes }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

```ts
// src/app/api/attachments/[id]/route.ts
import fs from "node:fs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { attachmentPath, getAttachment } from "@/domain/attachments";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const a = getAttachment(getDb(), id);
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const file = attachmentPath(a);
    if (!fs.existsSync(file)) return NextResponse.json({ error: "File missing" }, { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: { "content-type": a.mime, "content-length": String(a.bytes), "cache-control": "private, max-age=31536000, immutable" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: Backup copies attachments**

In `src/jobs/handlers/backup.ts`, after the database backup, copy the attachments directory when it exists to `backupsDir()/attachments-<stamp>` with `fs.cpSync(src, dest, { recursive: true })`, and extend `pruneOldBackups` to also keep only the newest 7 `attachments-*` directories (`NAME_RE` becomes two patterns or a second call with `/^attachments-.*$/` and `fs.rmSync(..., { recursive: true })`). Add a case to `backup.test.ts`: create an attachment, run the handler, assert `backups/attachments-<today>/<itemId>/` contains the file.

- [ ] **Step 8: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/db/schema.ts drizzle src/lib src/domain src/app/api/attachments src/app/api/attachments.test.ts src/jobs/handlers
git commit -m "feat(notes): image attachments with upload, serve, cascade delete, and backup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Editor core with markdown round-trip

**Files:**
- Modify: `package.json` (dependencies), `vitest.config.ts`
- Create: `src/components/editor/extensions.ts`, `src/components/editor/callout.ts`, `src/components/editor/rich-editor.tsx`, `src/components/editor/editor.css`, `src/components/editor/fixtures/*.md`
- Modify: `src/app/globals.css` (import the editor css)
- Test: `src/components/editor/roundtrip.test.ts`, `src/components/editor/rich-editor.test.tsx`

**Interfaces:**
- Produces:
  - `buildExtensions(opts: { placeholder?: string }): Extensions` (StarterKit with `codeBlock: false` and `link` configured to open in a new tab, `CodeBlockLowlight` with `createLowlight(common)`, `TaskList`, `TaskItem.configure({ nested: true })`, `Table.configure({ resizable: false })`, `TableRow`, `TableHeader`, `TableCell`, `Image.configure({ inline: false, allowBase64: false })`, `Placeholder.configure({ placeholder })`, `Markdown`, `Callout`)
  - `markdownToDoc(markdown: string, extensions): JSONContent` and `docToMarkdown(editor): string` are not separate helpers; use the editor API: `new Editor({ element, extensions, content, contentType: "markdown" })` and `editor.getMarkdown()`.
  - `RichEditor` props: `{ value: string; onChange: (markdown: string) => void; onBlur?: () => void; placeholder?: string; autofocus?: boolean; className?: string; itemId?: number; onReady?: (editor: Editor) => void }`. `itemId` is needed for image upload (Task 3); without it image paste is refused with a notice.
  - Contract: no `onChange` on mount; `onChange` debounced 300 ms after each user transaction (`transaction.docChanged && !transaction.getMeta("external")`); when the `value` prop changes to something other than the last markdown the editor emitted or received, the editor calls `setContent(value, { contentType: "markdown", emitUpdate: false })` tagged as external.
  - `RichEditorFallback`: an error boundary class component; on error renders `Textarea` with the same `value`, `onChange`, `onBlur`, `placeholder`, and a banner `"Rich editor unavailable, using plain text."`.
  - Callout convention: a blockquote whose first paragraph begins with `[!note]`, `[!tip]`, or `[!warning]` gets the class `callout callout-<kind>` on its DOM node and the marker text gets the inline class `callout-marker`.

- [ ] **Step 1: Install dependencies and configure vitest**

Run:

```bash
npm install @tiptap/react@3.31.3 @tiptap/core@3.31.3 @tiptap/pm@3.31.3 @tiptap/starter-kit@3.31.3 @tiptap/markdown@3.31.3 @tiptap/extension-task-list@3.31.3 @tiptap/extension-task-item@3.31.3 @tiptap/extension-table@3.31.3 @tiptap/extension-image@3.31.3 @tiptap/extension-placeholder@3.31.3 @tiptap/extension-code-block-lowlight@3.31.3 @tiptap/suggestion@3.31.3 @tiptap/extension-drag-handle-react@3.31.3 @floating-ui/dom@1.8.0 lowlight@3.3.0
npm install -D jsdom@30.0.1 @testing-library/react@16.3.3
```

`vitest.config.ts`: add `esbuild: { jsx: "automatic" }` at the top level of the config and change `include` to `["src/**/*.test.{ts,tsx}"]`.

- [ ] **Step 2: Write the round-trip fixtures and failing test**

Create these files under `src/components/editor/fixtures/` (each ends with a single newline):

`blocks.md`
```md
# Heading one

## Heading two

### Heading three

A paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).

- Bullet one
- Bullet two
  - Nested bullet

1. First
2. Second

> A quote

---

```ts
const x = 1;
```
```

`tasks.md`
```md
- [ ] Open task
- [x] Done task
  - [ ] Nested task
```

`table.md`
```md
| Name | Role |
| --- | --- |
| Ada | Engineer |
| Grace | Admiral |
```

`callouts.md`
```md
> [!note]
> Something to remember.

> [!tip]
> Try this.

> [!warning]
> Careful here.
```

`image.md`
```md
![Screenshot](/api/attachments/12)
```

`html.md`
```md
Before.

<div class="x">raw</div>

After.
```

```ts
// src/components/editor/roundtrip.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { prepareMarkdown } from "./rich-editor";

const dir = path.join(__dirname, "fixtures");
const normalise = (s: string) => s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "") + "\n";

function roundTrip(md: string): string {
  const el = document.createElement("div");
  const editor = new Editor({ element: el, extensions: buildExtensions({}), content: prepareMarkdown(md), contentType: "markdown" });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}

describe("markdown round-trip", () => {
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "html.md")) {
    it(`preserves ${name}`, () => {
      const input = fs.readFileSync(path.join(dir, name), "utf8");
      expect(normalise(roundTrip(input))).toBe(normalise(input));
    });
  }

  it("is idempotent", () => {
    const input = fs.readFileSync(path.join(dir, "blocks.md"), "utf8");
    const once = roundTrip(input);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps raw html as a fenced block", () => {
    const input = fs.readFileSync(path.join(dir, "html.md"), "utf8");
    const out = roundTrip(input);
    expect(out).toContain("```html\n<div class=\"x\">raw</div>\n```");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
  });
});
```

The fixtures are written in the serializer's canonical style. If `@tiptap/markdown` emits a different but equivalent form for some construct (for example `*` bullets instead of `-`), change the fixture to the canonical form and record the change in the task report; do not loosen the test.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/components/editor/roundtrip.test.ts`
Expected: FAIL, cannot find module `./extensions`.

- [ ] **Step 4: Implement extensions, callout plugin, RichEditor**

```ts
// src/components/editor/callout.ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export const CALLOUT_KINDS = ["note", "tip", "warning"] as const;
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
    decos.push(Decoration.inline(from, from + m[0].length, { class: "callout-marker" }));
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
```

```ts
// src/components/editor/extensions.ts
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Callout } from "./callout";

const lowlight = createLowlight(common);

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
  ];
}
```

If `@tiptap/extension-table` in 3.31.3 exports a `TableKit` instead of the four named exports, use `TableKit.configure({ table: { resizable: false } })`; check `node_modules/@tiptap/extension-table/dist/index.d.ts` before deciding.

```tsx
// src/components/editor/rich-editor.tsx
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
const HTML_BLOCK = /^(<\/?[a-zA-Z][^\n]*>)[\s\S]*?(?=\n\n|\n*$)/gm;

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
  onChangeRef.current = onChange;

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
```

If `setContent`'s options object in 3.31.3 does not accept `contentType`, use `editor.commands.setContent(editor.markdown.parse(md), { emitUpdate: false })` per the `@tiptap/markdown` README in `node_modules/@tiptap/markdown/README.md`; read that file before writing the call. Likewise confirm the exact `getMarkdown()` name there.

`src/components/editor/editor.css` (imported at the end of `src/app/globals.css` with `@import "../components/editor/editor.css";`):

```css
/* Editor chrome. Content typography comes from .md in globals.css. */
.rich-editor {
  min-height: 260px;
  outline: none;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-2);
  transition: border-color 150ms;
}
.rich-editor:focus-within,
.rich-editor:focus {
  border-color: var(--color-line-strong);
}
.rich-editor p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--color-fg-faint);
  float: left;
  height: 0;
  pointer-events: none;
}
.rich-editor ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0.2em;
}
.rich-editor ul[data-type="taskList"] li {
  display: flex;
  gap: 0.5em;
  align-items: flex-start;
}
.rich-editor ul[data-type="taskList"] input[type="checkbox"] {
  accent-color: var(--color-accent);
  margin-top: 0.35em;
}
.rich-editor table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.6em 0;
}
.rich-editor th,
.rich-editor td {
  border: 1px solid var(--color-line);
  padding: 0.35em 0.6em;
  vertical-align: top;
}
.rich-editor th {
  background: var(--color-surface-1);
  font-weight: 500;
}
.rich-editor .selectedCell {
  background: var(--color-accent-dim);
}
.rich-editor img {
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--color-line);
}
.rich-editor img.ProseMirror-selectednode {
  outline: 2px solid rgba(76, 201, 255, 0.55);
}
.rich-editor .callout {
  border-left-width: 3px;
  border-radius: 6px;
  padding: 0.6em 0.9em;
  color: var(--color-fg);
}
.rich-editor .callout-note { background: var(--color-accent-dim); border-color: var(--color-accent); }
.rich-editor .callout-tip { background: rgba(82, 211, 138, 0.14); border-color: var(--color-success); }
.rich-editor .callout-warning { background: rgba(245, 196, 81, 0.14); border-color: var(--color-warn); }
.rich-editor .callout-marker {
  font-family: var(--font-mono);
  font-size: 0.8em;
  color: var(--color-fg-faint);
}
.rich-editor pre code.hljs { background: none; padding: 0; }
.rich-editor .hljs-keyword, .rich-editor .hljs-tag { color: #c084fc; }
.rich-editor .hljs-string, .rich-editor .hljs-attr { color: #52d38a; }
.rich-editor .hljs-number, .rich-editor .hljs-literal { color: #f5c451; }
.rich-editor .hljs-comment { color: var(--color-fg-faint); }
.rich-editor .hljs-title, .rich-editor .hljs-function { color: #4cc9ff; }
```

- [ ] **Step 5: Component contract test**

```tsx
// src/components/editor/rich-editor.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { RichEditor } from "./rich-editor";

async function mount(value: string, onChange = vi.fn()) {
  let editor: Editor | undefined;
  const utils = render(<RichEditor value={value} onChange={onChange} onReady={(e) => (editor = e)} />);
  for (let i = 0; i < 10 && !editor; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  if (!editor) throw new Error("editor did not mount");
  return { editor, onChange, ...utils };
}

describe("RichEditor", () => {
  it("does not emit on mount and emits debounced markdown after typing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { editor, onChange } = await mount("# Title\n\nHello.\n");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { editor.commands.focus("end"); editor.commands.insertContent(" World"); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("Hello. World");
    vi.useRealTimers();
  });

  it("replaces content on an external value change without emitting", async () => {
    const onChange = vi.fn();
    const { editor, rerender } = await mount("One\n", onChange);
    rerender(<RichEditor value={"Two\n"} onChange={onChange} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(editor.getText()).toBe("Two");
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green. If `npm run build` complains that `@tiptap/react` must be client-only, confirm `"use client"` sits at the top of `rich-editor.tsx` and that nothing server-side imports it.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/components/editor src/app/globals.css
git commit -m "feat(notes): rich editor core with markdown round-trip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Slash menu, bubble menu, drag handle, images

**Files:**
- Create: `src/components/editor/slash-menu.tsx`, `src/components/editor/bubble-menu.tsx`, `src/components/editor/images.ts`
- Modify: `src/components/editor/extensions.ts` (add the slash extension), `src/components/editor/rich-editor.tsx` (render menus, drag handle, image handlers), `src/components/editor/editor.css`
- Test: `src/components/editor/images.test.ts` (node), `src/components/editor/slash-menu.test.tsx` (jsdom)

**Interfaces:**
- Produces:
  - `SLASH_ITEMS: { id: string; label: string; hint: string; icon: LucideIcon; run: (editor: Editor) => void }[]` in this order: Heading 1, Heading 2, Heading 3, Bulleted list, Numbered list, Checklist, Quote, Code, Table, Image, Callout, Divider.
  - `filterSlashItems(query: string): typeof SLASH_ITEMS` (case-insensitive prefix or substring on label).
  - `SlashCommand` extension built on `@tiptap/suggestion` with `char: "/"`, `startOfLine: false`, `allowSpaces: false`, rendering `SlashMenu` in a `frost` popover positioned with `@floating-ui/dom` at the caret rect.
  - `uploadImage(file: File, itemId: number): Promise<{ url: string }>` (POST `/api/attachments`, throws `Error` with the server's `error` text on failure).
  - `isImageFile(file: File): boolean` for the allowed mimes.
  - `insertImageWithUpload(editor, file, itemId)`: inserts a placeholder paragraph `Uploading image…` is **not** allowed by the copy rules (no ellipsis strings needed); insert a paragraph with the text `Uploading image` and the attribute `data-upload-id`, then replace it with an `image` node on success, or with the text `Image upload failed: <reason>` plus two inline buttons, "Retry" and "Remove", rendered by a small node view. To keep it simple: the failure state is a paragraph with the text and the retry lives in the bubble menu; the plan accepts `Image upload failed` text with a "Retry" `Button` rendered inside a `React` node view named `uploadFailed` (a leaf node with attrs `{ name, reason }`, `renderHTML` to a `<span data-upload-failed>` and a React node view with the two buttons). This node never serialises to markdown: give it `parseMarkdown: () => null` and `renderMarkdown: () => ""` so a note saved mid-failure drops the placeholder rather than writing junk.
  - Non-image drops: send through `POST /api/upload` (existing capture) with `file` only, then insert a paragraph containing a link `[<name>](/items/<id>)`.

- [ ] **Step 1: Failing tests**

```ts
// src/components/editor/images.test.ts
import { describe, it, expect, vi } from "vitest";
import { isImageFile, uploadImage } from "./images";

describe("images", () => {
  it("recognises allowed image types", () => {
    expect(isImageFile(new File([""], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([""], "a.svg", { type: "image/svg+xml" }))).toBe(false);
    expect(isImageFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("uploads and surfaces server errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 3, url: "/api/attachments/3" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Images must be 20 MB or smaller" }), { status: 413 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadImage(new File(["x"], "a.png", { type: "image/png" }), 7)).toEqual({ url: "/api/attachments/3" });
    const body = fetchMock.mock.calls[0][1] as RequestInit;
    expect((body.body as FormData).get("itemId")).toBe("7");
    await expect(uploadImage(new File(["x"], "a.png", { type: "image/png" }), 7)).rejects.toThrow(/20 MB/);
    vi.unstubAllGlobals();
  });
});
```

```tsx
// src/components/editor/slash-menu.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { filterSlashItems, SLASH_ITEMS } from "./slash-menu";

describe("slash menu", () => {
  it("lists every block in order and filters", () => {
    expect(SLASH_ITEMS.map((i) => i.label)).toEqual([
      "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Checklist", "Quote", "Code", "Table", "Image", "Callout", "Divider",
    ]);
    expect(filterSlashItems("head").map((i) => i.label)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(filterSlashItems("LIST").map((i) => i.label)).toEqual(["Bulleted list", "Numbered list", "Checklist"]);
    expect(filterSlashItems("zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement images.ts**

```ts
// src/components/editor/images.ts
import type { Editor } from "@tiptap/core";

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function isImageFile(file: File): boolean {
  return IMAGE_MIMES.includes(file.type);
}

export async function uploadImage(file: File, itemId: number): Promise<{ url: string }> {
  const form = new FormData();
  form.set("itemId", String(itemId));
  form.set("file", file);
  const res = await fetch("/api/attachments", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { url: data.url };
}

export async function uploadFileAsItem(file: File): Promise<{ id: number; title: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { id?: number; title?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { id: data.id, title: data.title ?? file.name };
}

let uploadSeq = 0;

/** Insert a placeholder at the selection, upload, then swap in the image or a failure node. */
export function insertImageWithUpload(editor: Editor, file: File, itemId: number | undefined): void {
  if (itemId === undefined) {
    editor.chain().focus().insertContent({ type: "uploadFailed", attrs: { name: file.name, reason: "Save the note before adding images" } }).run();
    return;
  }
  const id = `upload-${++uploadSeq}`;
  editor.chain().focus().insertContent({ type: "paragraph", attrs: { uploadId: id }, content: [{ type: "text", text: "Uploading image" }] }).run();
  const replace = (content: object) => {
    const { doc } = editor.state;
    let from = -1;
    let to = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.attrs.uploadId === id) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (from >= 0) editor.chain().insertContentAt({ from, to }, content).run();
  };
  uploadImage(file, itemId)
    .then(({ url }) => replace({ type: "image", attrs: { src: url, alt: file.name } }))
    .catch((err: unknown) => replace({ type: "uploadFailed", attrs: { name: file.name, reason: err instanceof Error ? err.message : "Upload failed" } }));
}

export function handleFiles(editor: Editor, files: File[], itemId: number | undefined): boolean {
  if (files.length === 0) return false;
  for (const file of files) {
    if (isImageFile(file)) insertImageWithUpload(editor, file, itemId);
    else {
      void uploadFileAsItem(file)
        .then(({ id, title }) => editor.chain().focus().insertContent({ type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "link", attrs: { href: `/items/${id}` } }] }] }).run())
        .catch((err: unknown) => editor.chain().focus().insertContent({ type: "uploadFailed", attrs: { name: file.name, reason: err instanceof Error ? err.message : "Upload failed" } }).run());
    }
  }
  return true;
}
```

The `paragraph` node needs an `uploadId` attribute: extend it in `extensions.ts` with `Paragraph.extend({ addAttributes() { return { ...this.parent?.(), uploadId: { default: null, rendered: false } }; } })` and pass `paragraph: false` to `StarterKit.configure`, adding the extended `Paragraph` explicitly. The `uploadFailed` node (`src/components/editor/upload-failed.tsx`): `Node.create({ name: "uploadFailed", group: "block", atom: true, addAttributes: () => ({ name: { default: "" }, reason: { default: "" } }), parseHTML: () => [{ tag: "div[data-upload-failed]" }], renderHTML: ({ HTMLAttributes }) => ["div", { "data-upload-failed": "", ...HTMLAttributes }], addNodeView: () => ReactNodeViewRenderer(UploadFailedView), renderMarkdown: () => "" })`; `UploadFailedView` renders `NodeViewWrapper` with the text `Image upload failed: {reason}` in `text-danger text-[13px]`, a `Button size="sm" variant="secondary"` "Retry" (re-opens the file picker for that node: an `<input type="file" accept="image/*">` triggered by the button, then `insertImageWithUpload` at the node's position and `deleteNode()`), and `Button size="sm" variant="ghost"` "Remove" (`deleteNode()`). Confirm the markdown-extension hook names (`renderMarkdown`/`parseMarkdown` or `markdown: { serialize }`) in `node_modules/@tiptap/markdown/README.md` and use the documented ones.

In `rich-editor.tsx` add to `editorProps`:

```ts
handlePaste: (_view, event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  return files.length ? (event.preventDefault(), handleFiles(editorRef.current!, files, itemId)) : false;
},
handleDrop: (_view, event) => {
  const files = [...(event.dataTransfer?.files ?? [])];
  return files.length ? (event.preventDefault(), handleFiles(editorRef.current!, files, itemId)) : false;
},
```

where `editorRef` is set from `useEditor`'s result in an effect.

- [ ] **Step 3: Slash menu**

`slash-menu.tsx` exports `SLASH_ITEMS`, `filterSlashItems`, `SlashCommand` (the extension), and the `SlashMenu` React component. The extension uses `Suggestion` from `@tiptap/suggestion` with `char: "/"`, `command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); props.run(editor); }`, `items: ({ query }) => filterSlashItems(query)`, and `render()` returning `onStart`/`onUpdate`/`onKeyDown`/`onExit` that mount `SlashMenu` with `createRoot` into a `div.frost.rounded-md.p-1.w-64.z-50` appended to `document.body`, positioned with `computePosition(virtualReference, el, { placement: "bottom-start", middleware: [offset(6), flip(), shift()] })` from `@floating-ui/dom` using `props.clientRect`. `onKeyDown` handles ArrowUp, ArrowDown, Enter, Escape. `SlashMenu` renders `items` as `Row`-like buttons: icon, label, and `hint` in `text-fg-faint text-[11.5px]`; the selected row has `bg-surface-3`. Empty query shows all twelve; no match shows "No blocks match" in `text-fg-faint`.

`run` implementations: headings `editor.chain().focus().setHeading({ level }).run()`; lists `toggleBulletList` / `toggleOrderedList` / `toggleTaskList`; quote `toggleBlockquote`; code `toggleCodeBlock`; table `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`; image opens a hidden `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp">` (a ref held by `RichEditor`, exposed through a small event: the slash item dispatches `editor.emit("sb:pick-image")`, and `RichEditor` listens with `editor.on("sb:pick-image", ...)` and clicks the input); callout inserts `{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "[!note] " }] }] }`; divider `setHorizontalRule`.

Add `SlashCommand` to `buildExtensions` (after `Callout`).

- [ ] **Step 4: Bubble menu and drag handle**

`bubble-menu.tsx`: `import { BubbleMenu } from "@tiptap/react/menus"`; renders when the selection is a non-empty text range outside code blocks (`shouldShow: ({ editor, from, to }) => from !== to && !editor.isActive("codeBlock")`), inside a `frost rounded-md p-1 flex gap-0.5`: `IconButton`s Bold (`Bold` icon, `toggleBold`), Italic (`Italic`), Code (`Code`), Strikethrough (`Strikethrough`), and Link (`Link2`): the link button toggles an inline `Input size="sm"` with placeholder "Paste a link"; Enter applies `setLink({ href })`, empty value runs `unsetLink`. Each `IconButton` gets `active={editor.isActive("bold")}` and so on; labels are the action names.

Drag handle: `import { DragHandle } from "@tiptap/extension-drag-handle-react"`; render `<DragHandle editor={editor}><span className="drag-handle" aria-hidden /></DragHandle>` inside `RichEditor`; CSS in `editor.css`: `.drag-handle { width: 14px; height: 18px; border-radius: 4px; background: radial-gradient(circle, var(--color-fg-faint) 1.2px, transparent 1.3px) 0 0 / 6px 6px; opacity: 0.7; cursor: grab; }`.

Tab and Shift+Tab: TaskItem and ListItem in StarterKit already handle nesting; verify by typing in the browser during Step 6.

- [ ] **Step 5: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor
git commit -m "feat(notes): slash menu, bubble menu, drag handle, and image uploads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Wire the editor into item, container, and person editors

**Files:**
- Modify: `src/components/item-editor.tsx`, `src/components/container-editor.tsx`, `src/components/person-editor.tsx`, `README.md`
- Test: `src/components/item-editor.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `RichEditor` from Task 2 and 3.

- [ ] **Step 1: Failing item-editor test**

```tsx
// src/components/item-editor.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { ItemEditor } from "./item-editor";
import type { ItemDTO } from "@/lib/dto";

const item: ItemDTO = {
  id: 4, type: "note", title: "T", body: "Hello.\n", status: "ready", error: null, sourceUrl: null, filePath: null, mimeType: null,
  extractedText: null, meta: {}, tags: [], journalDate: null, reviewWeek: null, containerId: null, container: null, archivedAt: null,
  people: [], createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("ItemEditor with RichEditor", () => {
  it("sends the same PATCH the textarea sent, once, after typing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ...item, body: "x" }), { status: 200 }); }
      return new Response(JSON.stringify(item), { status: 200 });
    }));
    let editor: Editor | undefined;
    render(<ItemEditor initial={item} onEditorReady={(e) => (editor = e)} />);
    for (let i = 0; i < 20 && !editor; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(0);
    await act(async () => { editor!.commands.focus("end"); editor!.commands.insertContent(" World"); });
    await act(async () => { vi.advanceTimersByTime(300 + 800 + 50); });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ title: "T", tags: [] });
    expect((patches[0] as { body: string }).body).toContain("Hello. World");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
```

`ItemEditor` gains an optional `onEditorReady?: (editor: Editor) => void` prop passed straight to `RichEditor`'s `onReady`; it is test-only plumbing and harmless in production. If `ItemEditor`'s props or fetch calls differ from what the test assumes (for example it fetches status on mount), adapt the fetch stub, not the assertion about one PATCH with `title`, `body`, and `tags`.

- [ ] **Step 2: Swap the textareas**

`item-editor.tsx`: replace the body `Textarea` (the `preview ? … : <Textarea …>` branch) with

```tsx
<RichEditor
  value={body}
  itemId={initial.id}
  onChange={(md) => {
    setBody(md);
    markDirty();
  }}
  onBlur={() => {
    if (save === "dirty") void persist();
  }}
  placeholder={item.type === "note" ? "Write, or press / for blocks" : "Your notes about this item"}
  className="min-h-[260px]"
  onReady={onEditorReady}
/>
```

Everything else in the file stays byte-identical. Because `RichEditor` treats a `value` that equals its last emitted markdown as no-op, the `setBody` round trip does not re-render the document.

`container-editor.tsx`: the description `Textarea` becomes `RichEditor` with `value={description}`, the same `onChange` body (`setDescription(md); markDirty()` or whatever the file's existing handler does), same `onBlur`, `placeholder="Description"`, `className="min-h-[120px]"`; the next-steps `Textarea` becomes `RichEditor` with `placeholder="- [ ] First step"` and `className="min-h-[120px]"` (checklist rendering replaces the mono textarea). No `itemId` on either (containers have no attachments; image paste shows the "Save the note before adding images" node, which is acceptable here and noted in the README).

`person-editor.tsx`: the profile `Textarea` becomes `RichEditor` with `placeholder="Who they are, their role, how you work together, open threads."` and `className="min-h-[200px]"`.

The preview toggles in item and person editors keep rendering `react-markdown` inside `.md`.

- [ ] **Step 3: README**

Under "How things are organised" add a short "Writing" paragraph: notes use a block editor; type `/` for blocks, markdown shortcuts work as you type, paste or drop images into a saved note, callouts are `> [!note]`, `> [!tip]`, `> [!warning]` blockquotes, and everything is stored as markdown so search and backups see plain text.

- [ ] **Step 4: Run tests, lint, build; look**

Run: `npm test && npm run lint && npm run build`. If a dev server is available on 3141 (controller's), open an item page: type `/` and pick Checklist, tick a box, paste an image, select text and bold it, drag a block; reload and confirm the markdown survived. Otherwise a 200 from `/items/4` is enough and the controller does the browser pass.

- [ ] **Step 5: Commit**

```bash
git add src/components README.md
git commit -m "feat(notes): rich editor on item, container, and person pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: editor and extensions (3.1) → Tasks 2 and 3 (slash menu, bubble menu, drag handle, markdown shortcuts via StarterKit input rules, callout convention via decoration rather than a custom node, tables, code with lowlight); attachments (3.2) → Task 1 plus Task 3's upload flow and the backup copy; placement (3.3) → Task 4 (capture stays a textarea); styling (3.4) → `editor.css` in Task 2; errors (3.5) → the fallback boundary and no-emit-on-mount contract in Task 2, upload failure node in Task 3; testing (3.6) → round-trip corpus, attachment tests, the item-editor PATCH test.
- Deviations from the spec, deliberate: the callout marker is shown muted rather than hidden (hiding text in ProseMirror without changing the document is fragile); the non-image drop uses the existing `/api/upload`; `svg` is rejected as the spec says.
- Placeholders: none. Every step carries its code or exact instructions; the two "read the README in node_modules" checks exist because 3.31.3's option names must be confirmed against the installed package rather than guessed.
- Type consistency: `RichEditorProps`, `buildExtensions`, `prepareMarkdown`, `handleFiles`, `insertImageWithUpload`, `uploadImage`, `uploadFileAsItem`, `SLASH_ITEMS`, `filterSlashItems`, `SlashCommand`, `Callout`, `AttachmentError`, `saveAttachment`, `attachmentPath` are used with the same names across tasks.
