# Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app the "paper on a dark desk" identity: ink chrome with brass accents and Manrope, paper document sheets set in Newsreader for item pages, a block editor with margin handles and a block menu, and a crafted dock.

**Architecture:** Tokens and primitives change once in `globals.css` and `ui.tsx`, and a scripted class-name codemod moves every component to the new names in one commit. Item pages are rebuilt as a document sheet component. The block editor gains three TipTap extensions (handles overlay, block keymap, block menu) on top of the existing markdown pipeline. The dock is rebuilt as its own small component set. Behaviour stays frozen everywhere except the editor additions.

**Tech Stack:** Next.js 16, React 19, Tailwind 4 `@theme`, `next/font/google` (Manrope, Newsreader, Geist Mono), TipTap 3.31.3 (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@floating-ui/dom`), lucide-react, Vitest 5 with jsdom for components.

**Spec:** `docs/superpowers/specs/2026-09-21-design-language-design.md` (binding). Functional behaviour from the earlier specs is unchanged.

## Global Constraints

- Tokens exactly as spec section 2, defined in `@theme` in `src/app/globals.css`; components use token classes only (no raw hex in TSX except the two SVG ring colours which use `var(--color-…)`).
- Fonts: Manrope (UI), Newsreader (documents), Geist Mono (numbers, code) via `next/font/google`, CSS variables `--font-ui`, `--font-doc`, `--font-mono`; no runtime font fetches.
- Copy rules: sentence case; no uppercase tracked labels; no middle-dot strings; buttons name the action; mono only for counts, dates, shortcuts, code.
- Behaviour freeze: no handler, fetch, autosave, polling, or keyboard logic changes outside the block-editor additions in Task 3; every `aria-label`, `title`, and `disabled` condition preserved.
- Every interactive element keeps a visible focus ring (`focus-ring` = brass ring on ink; on paper the ring uses `--color-brass` with a paper inner ring).
- Contrast per spec section 9; reduced motion respected (`motion-safe:` for scale and fades).
- `npm test && npm run lint && npm run build` pristine at the end of every task. Do not start a server on port 3141.
- Every commit ends with the two trailer lines shown in each commit step.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/layout.tsx` | fonts and body classes |
| `src/app/globals.css` | tokens, base layer, `.panel`, `.hairline-row`, `.on-paper`, `.md`, `.doc` typography |
| `scripts/codemod-tokens.sh` | one-shot class rename across `src/` (kept in the repo for the record) |
| `src/components/ui.tsx` | primitives restyled |
| `src/components/dock/dock.tsx`, `dock-item.tsx`, `dock-more.tsx` | the dock |
| `src/components/document/document-sheet.tsx`, `metadata-strip.tsx`, `tag-chips.tsx` | the paper sheet |
| `src/components/item-editor.tsx` | uses the sheet |
| `src/components/editor/block-handles.tsx`, `block-menu.tsx`, `block-keymap.ts`, `block-utils.ts` | block editor additions |
| `src/components/editor/slash-menu.tsx`, `bubble-menu.tsx`, `callout.ts`, `editor.css` | re-skin |
| `src/test/tokens.test.ts` | guard against old token names |

---

### Task 1: Fonts, tokens, primitives, codemod, dock

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui.tsx`, `src/components/icons.tsx`, `src/components/nav.ts`
- Create: `scripts/codemod-tokens.sh`, `src/components/dock/dock.tsx`, `src/components/dock/dock-item.tsx`, `src/components/dock/dock-more.tsx`, `src/test/tokens.test.ts`
- Delete: `src/components/dock.tsx` (moved)
- Modify (by codemod): every `src/**/*.tsx` and `*.ts` using the old classes

**Interfaces:**
- Produces: token classes `bg-ink`, `bg-slate`, `bg-slate-2`, `border-hairline`, `border-hairline-strong`, `divide-hairline`, `text-fg`, `text-fg-muted`, `text-fg-faint`, `bg-paper`, `bg-paper-2`, `text-paper-fg`, `text-paper-muted`, `text-brass`, `bg-brass`, `bg-brass-dim`, `text-brass-ink`, `border-brass`, `text-success`, `text-warn`, `text-danger`, `shadow-dock`, `shadow-paper`, `font-ui`, `font-doc`, `font-mono`; utility classes `.panel`, `.hairline-row`, `.on-paper`, `.focus-ring`, `.kbd`, `.live-dot`; `Dock` exported from `src/components/dock/dock.tsx`.

- [ ] **Step 1: Failing token-guard test**

```ts
// src/test/tokens.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const OLD = [/\bbg-bg\b/, /\bbg-surface-[123]\b/, /\bborder-line\b/, /\bborder-line-strong\b/, /\bdivide-line\b/, /\btext-accent\b/, /\bbg-accent\b/, /\bbg-accent-dim\b/, /\bborder-accent\b/, /\baccent-accent\b/, /\btext-bg\b/, /\bfrost\b/, /--font-geist-sans/, /#4cc9ff/i];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("design tokens", () => {
  it("no file uses the retired token classes", () => {
    const hits: string[] = [];
    for (const file of walk(path.join(process.cwd(), "src"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const re of OLD) if (re.test(text)) hits.push(`${path.relative(process.cwd(), file)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/test/tokens.test.ts`
Expected: FAIL with a long list of hits.

- [ ] **Step 3: Fonts and tokens**

`src/app/layout.tsx`:

```tsx
import { Manrope, Newsreader, Geist_Mono } from "next/font/google";
const ui = Manrope({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const doc = Newsreader({ variable: "--font-doc", subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], display: "swap", axes: ["opsz"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });
// html className={`${ui.variable} ${doc.variable} ${mono.variable}`}; body className="min-h-screen bg-ink text-fg font-ui"
```

If `axes: ["opsz"]` is rejected by the installed `next/font` types, drop it (Newsreader's default instance is fine).

`src/app/globals.css` `@theme` becomes:

```css
@theme {
  --color-ink: #0f1218;
  --color-slate: #171b23;
  --color-slate-2: #1e232d;
  --color-hairline: rgba(255, 255, 255, 0.08);
  --color-hairline-strong: rgba(255, 255, 255, 0.14);
  --color-fg: #edebe4;
  --color-fg-muted: #a3a8b4;
  --color-fg-faint: #6b7080;
  --color-paper: #f4f0e8;
  --color-paper-2: #ece7dd;
  --color-paper-rule: rgba(15, 18, 24, 0.1);
  --color-paper-fg: #1b1f27;
  --color-paper-muted: #5b6070;
  --color-brass: #e0a93c;
  --color-brass-dim: rgba(224, 169, 60, 0.16);
  --color-brass-ink: #2a1f07;
  --color-success: #7fb88a;
  --color-warn: #d9a441;
  --color-danger: #d66a5c;
  --font-ui: var(--font-ui), ui-sans-serif, system-ui, sans-serif;
  --font-doc: var(--font-doc), Georgia, "Times New Roman", serif;
  --font-mono: var(--font-mono), ui-monospace, "SF Mono", Menlo, monospace;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-dock: 0 20px 50px -20px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --shadow-paper: 0 30px 80px -40px rgba(0, 0, 0, 0.8), 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

Note: Tailwind 4 reads `--font-ui` from the theme and from `next/font`'s variable of the same name; to avoid the self-reference, name the next/font variables `--font-ui-src`, `--font-doc-src`, `--font-mono-src` and reference those inside the theme values.

Base layer: `body { background: var(--color-ink); color: var(--color-fg); font-family: var(--font-ui); font-size: 14px; line-height: 1.55 }`; `* { border-color: var(--color-hairline) }`; `::selection { background: var(--color-brass-dim) }`; `:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 2px }`.

Unlayered utilities:

```css
.focus-ring:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-ink), 0 0 0 4px var(--color-brass); }
.on-paper .focus-ring:focus-visible { box-shadow: 0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-brass); }
.panel { background: var(--color-slate); border: 1px solid var(--color-hairline-strong); box-shadow: var(--shadow-dock); }
.hairline-row { border-bottom: 1px solid var(--color-hairline); }
.hairline-row:last-child { border-bottom: 0; }
.on-paper { background: var(--color-paper); color: var(--color-paper-fg); }
.on-paper ::selection { background: var(--color-brass-dim); }
.on-paper a { color: #7a5a12; text-decoration: underline; text-underline-offset: 3px; }
.kbd { font-family: var(--font-mono); font-size: 10.5px; color: var(--color-fg-faint); border: 1px solid var(--color-hairline-strong); border-radius: 5px; padding: 1px 5px; background: var(--color-slate-2); }
```

`.md` keeps its structure but colours move to tokens (`.md a { color: var(--color-brass) }`, code on `slate-2`, quotes on `hairline-strong`). Add `.doc` (document typography, used inside `.on-paper` by Task 2): `font-family: var(--font-doc); font-size: 17px; line-height: 1.6; max-width: 68ch;` with `h1 30/1.2 500`, `h2 24/1.25 500`, `h3 19/1.3 500`, `p, ul, ol, pre, blockquote { margin: .7em 0 }`, `code` and `pre` in `font-mono` at 15px on `paper-2`, `blockquote { border-left: 2px solid var(--color-paper-rule); color: var(--color-paper-muted) }`, `hr { border-top: 1px solid var(--color-paper-rule) }`, `a` inherits `.on-paper a`. Remove `.frost`.

- [ ] **Step 4: Codemod**

```bash
# scripts/codemod-tokens.sh — one-shot rename of retired token classes; kept for the record.
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
files=$(grep -rlE 'bg-bg|bg-surface-|border-line|divide-line|text-accent|bg-accent|border-accent|accent-accent|text-bg|frost|bg-\[rgba\(24,24,28,0\.95\)\]' src --include='*.tsx' --include='*.ts' || true)
for f in $files; do
  perl -pi -e '
    s/\bhover:bg-surface-3\b/hover:bg-slate-2/g; s/\bhover:bg-surface-2\b/hover:bg-slate-2/g; s/\bhover:bg-surface-1\b/hover:bg-slate/g;
    s/\bbg-surface-3\b/bg-slate-2/g; s/\bbg-surface-2\b/bg-slate/g; s/\bbg-surface-1\b/bg-slate/g;
    s/\bbg-bg\b/bg-ink/g;
    s/\bborder-line-strong\b/border-hairline-strong/g; s/\bborder-line\b/border-hairline/g; s/\bdivide-line\b/divide-hairline/g;
    s/\bfocus:border-line-strong\b/focus:border-hairline-strong/g; s/\bhover:border-line-strong\b/hover:border-hairline-strong/g;
    s/\bbg-accent-dim\b/bg-brass-dim/g; s/\bbg-accent\b/bg-brass/g; s/\btext-accent\b/text-brass/g; s/\bborder-accent\b/border-brass/g; s/\baccent-accent\b/accent-brass/g;
    s/\btext-bg\b/text-brass-ink/g;
    s/\bfrost\b/panel/g;
    s/bg-\[rgba\(24,24,28,0\.95\)\]/bg-slate/g;
  ' "$f"
done
echo "codemod applied to $(echo "$files" | wc -w | tr -d " ") files"
```

Run it once: `bash scripts/codemod-tokens.sh`. Then hand-fix the cases a regex cannot: `bg-line-strong` (dock divider) → `bg-hairline-strong`; `border-accent/60` → `border-brass/60`; `bg-danger/5` and similar stay; the two `ProgressRing` colours already use `var(--color-…)` names, so update them to `var(--color-brass)`/`var(--color-success)`; `timeline.tsx`'s `DEFAULT_COLOR` stays a hex because it is a data colour for a category, not a UI token (add a comment). Any `text-[…px] uppercase` or `tracking-wider` found during the sweep is removed.

- [ ] **Step 5: Primitives**

In `src/components/ui.tsx`: `BUTTON_VARIANT` = primary `bg-brass text-brass-ink hover:brightness-105`, secondary `bg-slate border border-hairline hover:border-hairline-strong`, ghost `text-fg-muted hover:text-fg hover:bg-slate-2`; `FIELD` = `bg-slate border border-hairline text-fg placeholder:text-fg-faint hover:border-hairline-strong focus:border-hairline-strong`; `Chip` active = `border-brass/60 bg-brass-dim text-fg`; `IconButton` active = `text-brass bg-brass-dim`, danger = `text-danger hover:bg-danger/10`; `PageHeader` title `text-[22px] leading-7 font-medium tracking-[-0.01em]`; `List` becomes a plain `div` (no border, no bg) and `Row` uses `hairline-row flex items-center gap-3 px-3 h-11 hover:bg-slate-2 transition-colors`; `EmptyState` renders a single muted sentence plus the action, no dashed box, no icon circle (keep the `icon` prop accepted but render it small inline before the text); `Kbd` unchanged.

- [ ] **Step 6: Dock**

`src/components/nav.ts`: add `group: "para" | "tools"` to `NavItem` (Inbox, Projects, Areas, Resources, People = `para`; Activity, Library, Archive, Search = `tools`; Capture is removed from `NAV_ITEMS` and rendered by the dock itself; keep its `g c` shortcut in `shortcuts.tsx` and the palette by exporting `CAPTURE_ITEM` from `nav.ts`). Adjust `shortcuts.tsx`/`command-palette.tsx` if they iterate `NAV_ITEMS` for the capture entry (they should include `CAPTURE_ITEM`).

`src/components/dock/dock-item.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { ReactNode } from "react";

export function DockItem({ href, label, shortcut, active, badge, dot, children }: { href: string; label: string; shortcut: string; active: boolean; badge?: number; dot?: boolean; children: ReactNode }) {
  return (
    <li className="relative">
      <Link
        href={href}
        aria-label={[label, badge ? `${badge} waiting` : null, dot ? "not recording" : null].filter(Boolean).join(", ")}
        aria-current={active ? "page" : undefined}
        className={`focus-ring group relative flex items-center justify-center w-11 h-11 rounded-full transition-colors duration-150 motion-safe:active:scale-95 ${active ? "text-brass" : "text-fg-muted hover:text-fg hover:bg-slate-2"}`}
      >
        {children}
        {badge ? <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-brass text-brass-ink font-mono text-[10px] leading-4 text-center">{badge > 99 ? "99+" : badge}</span> : null}
        {dot && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />}
        <span role="tooltip" className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap panel rounded-md px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0">
          {label}
          <span className="kbd ml-2">{shortcut}</span>
        </span>
      </Link>
      {active && <span className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-[12px] text-brass whitespace-nowrap motion-safe:animate-[fade-in_150ms_ease-out]">{label}</span>}
    </li>
  );
}
```

Add `@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }` to `globals.css`.

`src/components/dock/dock.tsx`: keeps the two polling effects from the old dock byte for byte (inbox count and helper state); renders

```tsx
<nav aria-label="Main" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
  <ul className="panel flex items-center gap-1 px-2 h-14 rounded-full">
    {para items via DockItem}
    <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
    {tools items via DockItem}
    <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
    <li><Link href="/capture" aria-label="Capture" className="focus-ring group relative flex items-center justify-center w-10 h-10 rounded-full bg-brass text-brass-ink shadow-[0_6px_16px_-6px_rgba(224,169,60,.7)] motion-safe:active:scale-95"><Plus className="w-5 h-5" strokeWidth={2} aria-hidden />{tooltip "Capture" + kbd "g c"}</Link></li>
    <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
    <li><button … aria-label="Command palette" …><Command …/>{tooltip "Commands ⌘K"}</button></li>
  </ul>
</nav>
```

Below 720 px (`useMediaQuery("(max-width: 719px)")` implemented with `matchMedia` in an effect, initial `false`): render Inbox, Projects, Search, Capture, and a `DockMore` button (`MoreHorizontal`) that toggles a `panel` sheet above the dock listing the remaining entries as `Row`-like links; Escape closes; the button carries `aria-expanded`.

`src/components/icons.tsx`: `strokeWidth` 1.75 stays; icon size 20 px.

- [ ] **Step 7: Run tests, lint, build; screenshot pass; commit**

Run: `npm test && npm run lint && npm run build` (the token guard must pass). The controller screenshots the dock and three pages.

```bash
git add src scripts/codemod-tokens.sh
git commit -m "feat(design): ink and brass tokens, Manrope and Newsreader, primitives, dock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Document sheet for item pages

**Files:**
- Create: `src/components/document/document-sheet.tsx`, `src/components/document/metadata-strip.tsx`, `src/components/document/tag-chips.tsx`, `src/components/document/tag-chips.test.tsx`
- Modify: `src/components/item-editor.tsx`, `src/components/item-editor.test.tsx`, `src/components/editor/editor.css`, `src/components/editor/rich-editor.tsx` (paper variant class only)

**Interfaces:**
- Produces:
  - `DocumentSheet({ children, className? })`: `<section className="on-paper doc-sheet …">` — `rounded-lg shadow-paper mx-auto w-full max-w-[880px] px-8 lg:px-12 py-10 min-h-[calc(100vh-9rem)]`.
  - `MetadataStrip({ children })`: `flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-paper-muted` with `<span className="w-px h-3 bg-paper-rule" aria-hidden />` separators between groups.
  - `TagChips({ value: string[]; onChange(next: string[]): void; readOnly? })`: chips with an inline "Add tag" affordance (a small input that appears on click, Enter or comma commits, Escape cancels, Backspace on empty removes the last), each chip has a remove button labelled `Remove tag <name>`.
  - `RichEditor` accepts `variant?: "ink" | "paper"`; paper adds `doc on-paper-editor` classes (no border, transparent background, 40 px left padding reserved for handles) and passes `placeholder`.

- [ ] **Step 1: Failing tag-chips test**

```tsx
// src/components/document/tag-chips.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TagChips } from "./tag-chips";

afterEach(cleanup);

describe("TagChips", () => {
  it("adds on Enter and comma, removes with the button and Backspace", () => {
    const onChange = vi.fn();
    render(<TagChips value={["draft"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByPlaceholderText("Tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["draft", "ideas"]);
    fireEvent.change(input, { target: { value: "later," } });
    expect(onChange).toHaveBeenLastCalledWith(["draft", "later"]);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag draft" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

Adjust the Backspace expectation to the value the component actually holds after the previous `onChange` (the test re-renders with the parent's value; use a small wrapper component with `useState` so each `onChange` feeds back). Write it that way from the start:

```tsx
function Harness({ onChange }: { onChange: (v: string[]) => void }) {
  const [tags, setTags] = useState(["draft"]);
  return <TagChips value={tags} onChange={(v) => { setTags(v); onChange(v); }} />;
}
```

and assert the sequence `["draft","ideas"]`, `["draft","ideas","later"]`, `["draft","ideas"]` (Backspace on empty removes the last), then `["ideas"]` after removing draft.

- [ ] **Step 2: Implement the components**

`tag-chips.tsx`: chips `inline-flex items-center gap-1 h-6 px-2 rounded-full border border-paper-rule text-[12.5px] text-paper-fg` with an `X` button; the add affordance is a `button` "Add tag" (`text-paper-muted hover:text-paper-fg`) that swaps to an `input` (`bg-transparent outline-none border-b border-paper-rule focus:border-brass text-[12.5px] w-24`, placeholder "Tag"); commits on Enter, comma, or blur; lowercases and trims; ignores duplicates and empties.

`document-sheet.tsx` and `metadata-strip.tsx` as the interfaces describe.

`item-editor.tsx` restructure (behaviour freeze: `persist`, `markDirty`, `patchMeta`, polling, ⌘S, retry, remove, confirmDelete, movePicker, peoplePicker all unchanged; only JSX moves):
- Toolbar stays on ink as today (back link, id, type, status dot, home chip, archived tag, save state, icon actions).
- Below it `<DocumentSheet>`:
  - title `input` with `font-doc text-[40px] leading-[1.1] font-medium tracking-[-0.01em] bg-transparent outline-none w-full text-paper-fg placeholder:text-paper-muted/60` and the same handlers.
  - `MetadataStrip`: type label with `TypeIcon`; home chip (the existing `Chip` that opens the move picker, restyled for paper via a `tone="paper"` prop on `Chip`: `border-paper-rule text-paper-fg`); `TagChips` bound to the existing `tags` state (`onChange` sets `tags` as the comma-joined string the editor already stores, then `markDirty()`); people chips (existing `Chip href` per person) plus the existing "Add person" ghost button; `Created <mono date>`.
  - a `<hr className="border-paper-rule my-4" />`.
  - for links: `<a href={sourceUrl} …>` in brass-ink underline with the `ExternalLink` icon; for files: the download link; both under the strip.
  - the body: preview renders `<div className="doc md">` with `react-markdown` + `remarkGfm`; edit renders `RichEditor variant="paper"` with the same props as today.
  - the extracted-text `<details>` becomes a `paper-2` block with a `summary` "Extracted text" in `text-paper-muted`.
- Errors (`item.error`, `actionError`) render above the sheet on ink, unchanged.
- `src/app/items/[id]/page.tsx` needs no change unless it wraps the editor in a width container; the sheet centres itself.

`editor.css`: add

```css
.on-paper-editor { background: transparent; border: 0; padding: 0 0 0 40px; min-height: 40vh; }
.on-paper-editor:focus-within { border: 0; }
.on-paper .rich-editor p.is-editor-empty:first-child::before { color: var(--color-paper-muted); opacity: .7; }
.on-paper .rich-editor .callout-note { background: var(--color-brass-dim); border-color: var(--color-brass); }
.on-paper .rich-editor .callout-tip { background: rgba(127,184,138,.18); border-color: var(--color-success); }
.on-paper .rich-editor .callout-warning { background: rgba(217,164,65,.18); border-color: var(--color-warn); }
.on-paper .rich-editor pre { background: var(--color-paper-2); border-color: var(--color-paper-rule); }
.on-paper .rich-editor th, .on-paper .rich-editor td { border-color: var(--color-paper-rule); }
.on-paper .rich-editor img { border-color: var(--color-paper-rule); }
```

- [ ] **Step 3: Update the item-editor test**

`src/components/item-editor.test.tsx` keeps its assertions (one PATCH with `title`, `body`, `tags` after typing; ⌘S flush) — only selectors change if the title input's placeholder changed (it did not: "Untitled"). Add one case: adding a tag through `TagChips` and pressing ⌘S sends a PATCH whose `tags` array contains the new tag.

- [ ] **Step 4: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/components/document src/components/item-editor.tsx src/components/item-editor.test.tsx src/components/editor src/components/ui.tsx
git commit -m "feat(design): item pages as paper document sheets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Block editor: handles, block menu, keymap, re-skinned menus

**Files:**
- Create: `src/components/editor/block-utils.ts`, `src/components/editor/block-keymap.ts`, `src/components/editor/block-handles.tsx`, `src/components/editor/block-menu.tsx`, `src/components/editor/block-keymap.test.ts`, `src/components/editor/block-utils.test.ts`
- Modify: `src/components/editor/extensions.ts`, `src/components/editor/rich-editor.tsx`, `src/components/editor/slash-menu.tsx`, `src/components/editor/bubble-menu.tsx`, `src/components/editor/callout.ts`, `src/components/editor/editor.css`

**Interfaces:**
- Produces:
  - `block-utils.ts`: `topLevelBlockAt(state, pos): { node, pos, end } | null` (the depth-1 block containing `pos`), `moveBlock(editor, dir: "up" | "down"): boolean`, `duplicateBlock(editor, pos): boolean`, `deleteBlock(editor, pos): boolean`, `turnInto(editor, pos, kind: BlockKind): boolean` where `BlockKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote" | "callout" | "code"` (turn into preserves inline content; lists wrap the block's paragraph; callout wraps in a blockquote with the `[!note] ` marker).
  - `BlockKeymap` extension: `Mod-ArrowUp` / `Mod-ArrowDown` move the current block; `Backspace` at offset 0 of a heading turns it into a paragraph; `Mod-Shift-/` dispatches a `sb:block-menu` CustomEvent on the editor DOM with `{ pos }`.
  - `BlockHandles` React overlay rendered by `RichEditor`: tracks the hovered or focused top-level block (via `view.posAtCoords` on `mousemove` over the editor DOM, and `selection.$from` on transactions), positions a 32 px wide control at the block's top-left using `view.coordsAtPos(pos)` relative to the editor container, with `+` (`aria-label="Add block"`, opens the slash picker at the end of that block by inserting a `/` trigger paragraph after it) and a grip (`aria-label="Block options"`, `draggable`, click opens `BlockMenu`; drag uses `editor.view.dragging = { slice, move: true }` on `dragstart` so ProseMirror handles the drop).
  - `BlockMenu({ editor, pos, anchorEl, onClose })`: `panel` popover via portal + floating-ui (`right-start`), items: "Turn into" group (chips for the ten kinds, `aria-pressed` on the current), Duplicate, Move up, Move down, Delete (danger); Escape and outside click close; focus returns to the grip.
  - Slash menu: `panel` with grouped sections (Text: Paragraph, Heading 1–3; Lists: Bulleted, Numbered, Checklist; Blocks: Quote, Callout, Code, Table, Divider; Media: Image), `w-80`, rows `h-9` with icon + label and the hint in `text-fg-faint`, group titles in `text-[11px] text-fg-faint` (sentence case), keyboard navigation unchanged.
  - Bubble toolbar: `panel` with Bold, Italic, Strikethrough, Code, Link, and a "Turn into" `Select size="sm"` bound to `turnInto`.
  - Callout marker: the `callout-marker` decoration also sets `data-kind`; CSS hides the marker text (`font-size: 0`) and shows a lucide-style inline SVG icon via `::before` using a CSS mask on paper; the markdown is untouched.

- [ ] **Step 1: Failing utils and keymap tests**

```ts
// src/components/editor/block-utils.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { moveBlock, turnInto, duplicateBlock, deleteBlock, topLevelBlockAt } from "./block-utils";

function make(md: string): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: buildExtensions({}), content: md, contentType: "markdown" });
}

describe("block utils", () => {
  it("moves the current block up and down", () => {
    const e = make("One\n\nTwo\n\nThree\n");
    e.commands.setTextSelection(6); // inside "Two"
    expect(moveBlock(e, "up")).toBe(true);
    expect(e.getMarkdown()).toBe("Two\n\nOne\n\nThree");
    expect(moveBlock(e, "down")).toBe(true);
    expect(moveBlock(e, "down")).toBe(true);
    expect(e.getMarkdown()).toBe("One\n\nThree\n\nTwo");
    expect(moveBlock(e, "down")).toBe(false);
  });
  it("turns a paragraph into a heading, list, checklist, quote, callout, and back", () => {
    const e = make("Hello **there**\n");
    const b = topLevelBlockAt(e.state, 1)!;
    expect(turnInto(e, b.pos, "h2")).toBe(true);
    expect(e.getMarkdown()).toBe("## Hello **there**");
    expect(turnInto(e, 1, "task")).toBe(true);
    expect(e.getMarkdown()).toBe("- [ ] Hello **there**");
    expect(turnInto(e, 1, "callout")).toBe(true);
    expect(e.getMarkdown()).toBe("> \\[!note\\] Hello **there**");
    expect(turnInto(e, 1, "paragraph")).toBe(true);
    expect(e.getMarkdown()).toBe("Hello **there**");
  });
  it("duplicates and deletes", () => {
    const e = make("A\n\nB\n");
    expect(duplicateBlock(e, 1)).toBe(true);
    expect(e.getMarkdown()).toBe("A\n\nA\n\nB");
    expect(deleteBlock(e, 1)).toBe(true);
    expect(e.getMarkdown()).toBe("A\n\nB");
  });
});
```

```ts
// src/components/editor/block-keymap.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";

function make(md: string): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: buildExtensions({}), content: md, contentType: "markdown" });
}
function key(e: Editor, k: string, mods: Partial<KeyboardEventInit> = {}) {
  e.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
}

describe("block keymap", () => {
  it("Mod+ArrowDown moves the block", () => {
    const e = make("One\n\nTwo\n");
    e.commands.setTextSelection(1);
    key(e, "ArrowDown", { metaKey: true });
    expect(e.getMarkdown()).toBe("Two\n\nOne");
  });
  it("Backspace at the start of a heading makes it a paragraph", () => {
    const e = make("## Title\n");
    e.commands.setTextSelection(1);
    key(e, "Backspace");
    expect(e.getMarkdown()).toBe("Title");
  });
  it("Enter at the end of a heading starts a paragraph", () => {
    const e = make("## Title\n");
    e.commands.setTextSelection(7);
    key(e, "Enter");
    e.commands.insertContent("Body");
    expect(e.getMarkdown()).toBe("## Title\n\nBody");
  });
});
```

If `KeyboardEvent` dispatch does not reach ProseMirror's keymap under jsdom, call the extension's command functions directly (`e.commands.moveBlockUp()` etc.) and keep the Enter case via `e.commands.keyboardShortcut("Enter")`; record which path was used. Exact markdown strings follow the serializer's canonical form observed in `roundtrip.test.ts`; adjust trailing newlines to match `getMarkdown()`.

- [ ] **Step 2: Implement block-utils and keymap**

```ts
// src/components/editor/block-utils.ts
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";

export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote" | "callout" | "code";

export function topLevelBlockAt(state: EditorState, pos: number): { node: PMNode; pos: number; end: number } | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  if ($pos.depth === 0) {
    const index = $pos.index(0);
    if (index >= state.doc.childCount) return null;
    const node = state.doc.child(index);
    const start = $pos.posAtIndex(index, 0);
    return { node, pos: start, end: start + node.nodeSize };
  }
  const node = $pos.node(1);
  const start = $pos.before(1);
  return { node, pos: start, end: start + node.nodeSize };
}

export function moveBlock(editor: Editor, dir: "up" | "down"): boolean {
  const { state } = editor;
  const block = topLevelBlockAt(state, state.selection.from);
  if (!block) return false;
  const index = state.doc.resolve(block.pos).index(0);
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.doc.childCount) return false;
  const other = state.doc.child(target);
  const otherPos = dir === "up" ? block.pos - other.nodeSize : block.end;
  const tr = state.tr;
  if (dir === "up") {
    tr.delete(block.pos, block.end).insert(otherPos, block.node);
  } else {
    tr.delete(block.pos, block.end).insert(otherPos + other.nodeSize - block.node.nodeSize, block.node);
  }
  const newPos = dir === "up" ? otherPos : block.pos + other.nodeSize;
  tr.setSelection(state.selection.constructor.near(tr.doc.resolve(newPos + 1)) as typeof state.selection);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateBlock(editor: Editor, pos: number): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  if (!block) return false;
  editor.view.dispatch(editor.state.tr.insert(block.end, block.node.copy(block.node.content)));
  return true;
}

export function deleteBlock(editor: Editor, pos: number): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  if (!block) return false;
  const tr = editor.state.tr.delete(block.pos, block.end);
  if (tr.doc.childCount === 0) tr.insert(0, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr);
  return true;
}

function inlineContent(node: PMNode): Fragment {
  let frag = Fragment.empty;
  node.descendants((n) => {
    if (n.isTextblock) {
      frag = frag.append(n.content);
      return false;
    }
    return true;
  });
  return frag;
}

export function turnInto(editor: Editor, pos: number, kind: BlockKind): boolean {
  const block = topLevelBlockAt(editor.state, pos);
  if (!block) return false;
  const { schema } = editor;
  const content = inlineContent(block.node);
  const para = (frag: Fragment) => schema.nodes.paragraph.create(null, frag);
  let next: PMNode;
  switch (kind) {
    case "paragraph": next = para(content); break;
    case "h1": next = schema.nodes.heading.create({ level: 1 }, content); break;
    case "h2": next = schema.nodes.heading.create({ level: 2 }, content); break;
    case "h3": next = schema.nodes.heading.create({ level: 3 }, content); break;
    case "bullet": next = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, para(content))); break;
    case "ordered": next = schema.nodes.orderedList.create(null, schema.nodes.listItem.create(null, para(content))); break;
    case "task": next = schema.nodes.taskList.create(null, schema.nodes.taskItem.create({ checked: false }, para(content))); break;
    case "quote": next = schema.nodes.blockquote.create(null, para(content)); break;
    case "callout": next = schema.nodes.blockquote.create(null, para(Fragment.from(schema.text("[!note] ")).append(content))); break;
    case "code": next = schema.nodes.codeBlock.create(null, content.size ? schema.text(content.textBetween(0, content.size, "\n")) : undefined); break;
  }
  const tr = editor.state.tr.replaceWith(block.pos, block.end, next);
  editor.view.dispatch(tr);
  return true;
}
```

`Fragment.textBetween` exists on `Fragment`; if the installed types lack it, build the string with `content.forEach(n => …)`. Callout: the existing `Callout` decoration expects the marker at the start of the first paragraph; keep it as literal text (the serializer escapes brackets, matching the corpus).

```ts
// src/components/editor/block-keymap.ts
import { Extension } from "@tiptap/core";
import { moveBlock } from "./block-utils";

export const BlockKeymap = Extension.create({
  name: "blockKeymap",
  addCommands() {
    return {
      moveBlockUp: () => ({ editor }) => moveBlock(editor, "up"),
      moveBlockDown: () => ({ editor }) => moveBlock(editor, "down"),
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-ArrowUp": () => this.editor.commands.moveBlockUp(),
      "Mod-ArrowDown": () => this.editor.commands.moveBlockDown(),
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "heading") return false;
        return this.editor.commands.setParagraph();
      },
      "Mod-Shift-/": () => {
        this.editor.view.dom.dispatchEvent(new CustomEvent("sb:block-menu", { detail: { pos: this.editor.state.selection.from } }));
        return true;
      },
    };
  },
});
```

Augment TipTap's `Commands` interface for the two commands (module declaration in the same file). Add `BlockKeymap` to `buildExtensions` after `SlashCommand`.

- [ ] **Step 3: Handles and block menu**

`block-handles.tsx`: a client component `BlockHandles({ editor, containerRef })` rendered inside `RichEditor` next to `EditorContent`. State: `target: { pos, top } | null`. Effects: `mousemove` on `editor.view.dom` → `view.posAtCoords({ left, top })` → `topLevelBlockAt` → `view.coordsAtPos(block.pos + 1).top` minus the container's `getBoundingClientRect().top` → `setTarget`; `mouseleave` clears unless the menu is open; `editor.on("selectionUpdate")` sets the target from the selection when the editor has focus. Render at `absolute left-0` (inside the 40 px margin) `top: target.top`: two 24 px `button`s in a row: `Plus` ("Add block") and `GripVertical` ("Block options", `draggable`). `+` inserts an empty paragraph after the block, places the selection in it, and types `/` via `editor.commands.insertContent("/")` so the existing slash menu opens. The grip's `onClick` opens `BlockMenu`; `onDragStart` sets `editor.view.dragging = { slice: new Slice(Fragment.from(block.node), 0, 0), move: true }` and `event.dataTransfer.setData("text/html", "")`. Listens for `sb:block-menu` on the editor DOM to open the menu for the keyboard. Handles are `opacity-0 group-hover:opacity-100 focus-within:opacity-100` on the editor wrapper (`group`), always in the tab order.

`block-menu.tsx`: portal + floating-ui (`placement: "right-start"`, `offset(6)`, `flip()`, `shift()`), `panel rounded-md p-1 w-64`, `role="menu"`, first item focused on open, Tab wraps, Escape closes and refocuses the anchor. Sections: "Turn into" as a `role="group"` of `Chip`s (`menuitemradio`, `aria-checked` on the current kind from `block.node.type.name`/level/list type); then `menuitem` buttons Duplicate, Move up, Move down, Delete (danger). Each action calls the utils and closes.

Re-skin: slash menu sections and rows as the interfaces describe; bubble toolbar adds `Select size="sm"` "Turn into" with the ten kinds calling `turnInto(editor, selection.from, kind)`.

`callout.ts`: decoration on the marker adds `data-kind`; CSS in `editor.css`:

```css
.rich-editor .callout { position: relative; padding-left: 2.4em; }
.rich-editor .callout-marker { font-size: 0; }
.rich-editor .callout::before { content: ""; position: absolute; left: .8em; top: .85em; width: 1em; height: 1em; background: currentColor; -webkit-mask: var(--callout-icon) center / contain no-repeat; mask: var(--callout-icon) center / contain no-repeat; }
.rich-editor .callout-note { --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><path d='M12 16v-4M12 8h.01'/></svg>"); }
.rich-editor .callout-tip { --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z'/></svg>"); }
.rich-editor .callout-warning { --callout-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/><path d='M12 9v4M12 17h.01'/></svg>"); }
```

Images on paper: `.on-paper .rich-editor img { width: 100%; border-radius: var(--radius-md) }` and a caption via `figure`-less approach: `img[alt]:not([alt=""])::after` is not possible; render the caption in the `Image` node view instead: extend `Image` with a small React node view showing `alt` beneath in `text-paper-muted text-[13px]` (keep markdown `![alt](src)` unchanged).

- [ ] **Step 4: Wire into RichEditor**

`rich-editor.tsx`: wrap `EditorContent` in `<div ref={containerRef} className="relative group">`, render `<BlockHandles editor={editor} containerRef={containerRef} />` when `editor` exists; add `variant` handling from Task 2. Keep every existing prop and the `onChange`/flush contract untouched (the round-trip and contract tests must stay green).

- [ ] **Step 5: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add src/components/editor
git commit -m "feat(editor): block handles, block menu, keymap, re-skinned menus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Sweep of pages on the new chrome

**Files:**
- Modify: `src/app/{inbox,projects,areas,resources,people,library,archive,search,capture,activity}/**`, `src/components/{inbox-processor,search-panel,capture-box,capture-screen,container-list,container-editor,people-picker,container-picker,command-palette,complete-project-dialog,person-editor,new-container-form,new-person-form}.tsx`, `src/components/tasks/*.tsx`, `src/components/containers/*.tsx`, `src/components/activity/*.tsx`, `README.md`

**Interfaces:**
- Consumes: Task 1 tokens and primitives.

- [ ] **Step 1: Sweep rules**

Apply, file by file:
- Boxed lists (`rounded-lg border … divide-y`) become plain `List` + `hairline-row` rows; card-like `rounded-md border border-hairline bg-slate` wrappers around lists are removed; sections separate with 24 px of space and a `SectionHeading`.
- Project cards: `bg-slate rounded-lg` tiles, internal `hairline` separators, no `shadow`, hover `border-hairline-strong`; the ring uses brass.
- Search result cards and the inbox focus card: `bg-slate rounded-lg border border-hairline`; snippets in `text-fg-muted`; `mark` uses `bg-brass-dim text-fg`.
- Capture box: the `slate` surface with a hairline; the primary Capture button brass.
- Pickers, palette, dialog: `panel`.
- Activity: timeline track `bg-slate`, category colours stay data colours, legend text `fg-muted`, the rules drawer `panel`.
- Container editor: hero `bg-slate rounded-lg`, About disclosure and section headings per the chrome rules; Links and Notes rows as `hairline-row`.
- Any leftover `uppercase`, `tracking-wider`, or `·` is removed (grep proves zero).
- Empty states use the new `EmptyState` (sentence + action).
- README: replace the Design paragraph with: "The interface is a dark desk with paper documents on it: chrome in ink with brass for what needs attention, notes and journal pages on paper set in a serif, a block editor with handles, and a floating dock. Motion is limited to state changes and respects reduced-motion settings."

- [ ] **Step 2: Run tests, lint, build; screenshot pass**

Run: `npm test && npm run lint && npm run build`, then `grep -rn "uppercase\|tracking-wider\|·" src --include='*.tsx'` must return nothing. The controller screenshots Inbox, Projects, a project page, a note, a link item, Search, Activity, and the dock at 1440 and 720 px.

- [ ] **Step 3: Commit**

```bash
git add src README.md
git commit -m "feat(design): pages on the ink chrome

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: tokens (2) → Task 1; type (3) → Task 1 (`.doc`) and Task 2 (sheet typography); chrome (4) → Tasks 1 and 4; documents on paper (5) → Task 2; block editor (6) → Task 3; dock (7) → Task 1; migration (8) → Task 1's codemod and guard test; accessibility (9) → focus rings in Task 1, handles and menu keyboard access in Task 3; testing (10) → each task plus the controller's screenshots; order (11) matches.
- Placeholders: none; each code step carries its code. Two spots name a fallback if the installed API differs (font axes, keyboard dispatch under jsdom) with the exact alternative.
- Type consistency: `BlockKind`, `topLevelBlockAt`, `moveBlock`, `duplicateBlock`, `deleteBlock`, `turnInto`, `BlockKeymap`, `BlockHandles`, `BlockMenu`, `DocumentSheet`, `MetadataStrip`, `TagChips`, `DockItem`, `DockMore`, `CAPTURE_ITEM`, `variant` on `RichEditor`, `tone` on `Chip` are used with the same names across tasks.
