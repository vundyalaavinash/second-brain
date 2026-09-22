# Carbon Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating-dock frame with a carbon workspace: persistent sidebar, breadcrumb bar, portal-based context rail, and a prompt bar that captures, adds tasks, and searches from any page.

**Architecture:** Tokens change once in `globals.css` and a committed codemod renames classes across `src/`. The shell (`src/components/shell/`) wraps every page from `layout.tsx`; pages talk to the shell only through DOM portals (`#rail-slot`, `#crumb-slot`) and one tiny external store (current container), never shared React state. Capture logic is extracted from the capture page into a hook that both the page and the prompt bar use. The paper sheet is removed and item pages render on carbon with a rail.

**Tech Stack:** Next.js 16 App Router, React 19 (react-compiler lint), Tailwind 4 `@theme`, lucide-react, Vitest 5 (jsdom via `// @vitest-environment jsdom`), Drizzle + better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-09-22-carbon-shell-design.md` (binding). Functional behaviour from earlier specs is unchanged.

## Global Constraints

- Tokens exactly as spec section 2 in `@theme`; components use token classes only (no raw hex in TSX; the `timeline.tsx` data colours, the `Select` chevron data URI, and hljs colours keep their commented exceptions).
- Copy: sentence case; no middle dots; the only uppercase text is `.micro` labels (section labels in the rail, sidebar group headings, Today section names). Buttons name the action.
- Behaviour freeze: no handler, fetch, autosave, or keyboard logic changes outside `src/components/shell/`, `src/lib/use-capture.ts`, `src/lib/intent.ts`, and the polls that move from the dock into the sidebar unchanged (same URLs, intervals, event names). Every `aria-label`, `title`, and `disabled` condition preserved.
- Portals, not context, connect pages to the shell (`#rail-slot`, `#crumb-slot`); the current container is an external store read with `useSyncExternalStore`. Never call `setState` synchronously inside an effect body.
- Hydration deterministic: persisted sidebar state is read in an effect, never during render; dates use `todayLocal()` and `formatDate()`.
- Focus ring on every interactive element (`focus-ring`); reduced motion disables the glow breathing and press scaling; `<nav aria-label="Main">`, `<aside aria-label="Context">`, prompt bar `<form aria-label="Ask, capture, or add a task">`, toasts `role="status"`.
- `npm test && npm run lint && npm run build` pristine at the end of every task; `grep -rn "uppercase\|tracking-wider\|·" src --include='*.tsx'` may match only the `.micro` class definition's users via the class name (no inline `uppercase` utilities). Do not start a server on port 3141.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/globals.css` | carbon tokens, `.pane`, `.panel`, `.glow`, `.micro`, `.doc` on carbon |
| `scripts/codemod-carbon.sh` | one-shot class rename (kept for the record) |
| `src/test/tokens.test.ts` | retired-token guard (extended) |
| `src/components/nav.ts` | nav items with `section` |
| `src/components/shell/app-shell.tsx` | grid: sidebar, main (top bar + page + prompt bar), `#rail-slot` |
| `src/components/shell/sidebar.tsx`, `sidebar-tree.tsx`, `sidebar-tags.tsx` | navigation, container tree, tag chips, status card |
| `src/components/shell/top-bar.tsx`, `crumb.tsx` | breadcrumb bar and the `<Crumb>` portal |
| `src/components/shell/rail.tsx` | `<Rail>` portal and `<RailSection>` |
| `src/components/shell/toasts.tsx` | `ToastProvider`, `useToast` |
| `src/components/shell/prompt-bar.tsx`, `prompt-menu.tsx` | the bar and its `/` menu |
| `src/lib/intent.ts` | `detectIntent` |
| `src/lib/use-capture.ts` | `useCapture` hook (extracted from `capture-box.tsx`) |
| `src/lib/current-container.ts` | external store for the current container id |
| `src/lib/breadcrumb.ts` | `crumbsFor(pathname)` |
| `src/lib/headings.ts` | `headings(md)` |
| `src/domain/items/index.ts` | `listTagsWithCounts` |
| `src/app/api/tags/route.ts` | `?counts=1` |
| `src/app/today/page.tsx`, `src/components/today/today-page.tsx` | thin Today |
| `src/components/document/item-rail.tsx`, `src/components/containers/container-rail.tsx` | rails |

---

### Task 1: Tokens, codemod, shell frame (sidebar, top bar, rail, toasts), dock removal

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/nav.ts`, `src/components/shortcuts.tsx`, `src/components/command-palette.tsx`, `src/test/tokens.test.ts`, `src/components/ui.tsx`
- Create: `scripts/codemod-carbon.sh`, `src/components/shell/app-shell.tsx`, `sidebar.tsx`, `sidebar-tree.tsx`, `sidebar-tags.tsx`, `top-bar.tsx`, `crumb.tsx`, `rail.tsx`, `toasts.tsx`, `src/lib/breadcrumb.ts`, `src/lib/breadcrumb.test.ts`, `src/components/shell/rail.test.tsx`, `src/components/shell/sidebar-tree.test.tsx`
- Delete: `src/components/dock/` (all files, including tests)
- Modify (by codemod): every file using the renamed classes

**Interfaces:**
- Produces: token classes `bg-carbon`, `bg-layer-1/2/3`, `text-violet-bright`, `bg-violet`, `bg-violet-dim`, `border-violet`, `text-on-violet`, `shadow-pop`; classes `.pane`, `.panel`, `.glow`, `.glow-breathing`, `.micro`, `.hairline-row`, `.focus-ring`, `.kbd`; `NAV_ITEMS` with `section: "brain" | "tools"` and a Today entry; `AppShell({ children })`; `Rail({ children })`, `RailSection({ label, count?, children })`; `Crumb({ title })`; `crumbsFor(pathname): { label: string; href?: string }[]`; `ToastProvider`, `useToast(): { push(toast: { text: string; action?: { label: string; onClick(): void }; href?: string }): void }`; `window.dispatchEvent(new Event("sb:containers-changed"))` refreshes the sidebar tree.

- [ ] **Step 1: Failing guard and breadcrumb tests**

Extend `src/test/tokens.test.ts` `OLD` array with: `/\bbg-ink\b/, /\bbg-slate(-2)?\b/, /\bhover:bg-slate(-2)?\b/, /\b(text|bg|border|accent)-brass(-dim|-ink)?\b/, /\b(bg|text|border)-paper(-2|-rule|-fg|-muted|-link)?\b/, /\bon-paper\b/, /\bshadow-(dock|paper)\b/, /\btone=/`. Keep the existing entries.

```ts
// src/lib/breadcrumb.test.ts
import { describe, it, expect } from "vitest";
import { crumbsFor } from "./breadcrumb";

describe("crumbsFor", () => {
  it("maps top-level routes", () => {
    expect(crumbsFor("/inbox")).toEqual([{ label: "Inbox" }]);
    expect(crumbsFor("/today")).toEqual([{ label: "Today" }]);
    expect(crumbsFor("/search")).toEqual([{ label: "Search" }]);
  });
  it("nests containers, items, and people under their list", () => {
    expect(crumbsFor("/c/launch-newsletter")).toEqual([{ label: "Projects, areas, resources", href: "/projects" }, { label: "" }]);
    expect(crumbsFor("/items/13")).toEqual([{ label: "Library", href: "/library" }, { label: "" }]);
    expect(crumbsFor("/people/ada")).toEqual([{ label: "People", href: "/people" }, { label: "" }]);
  });
  it("falls back to Home", () => {
    expect(crumbsFor("/")).toEqual([{ label: "Home" }]);
  });
});
```

An empty last label means "the page supplies it through `<Crumb>`"; the bar renders the route label only when the slot is empty and the label is non-empty. For `/c/<slug>` the page's `<Crumb>` supplies the kind too, so the plain label above is a placeholder the page replaces (see Step 6).

```tsx
// src/components/shell/rail.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Rail, RailSection } from "./rail";

afterEach(cleanup);

describe("Rail", () => {
  it("portals its sections into #rail-slot", () => {
    const slot = document.createElement("div");
    slot.id = "rail-slot";
    document.body.appendChild(slot);
    render(<Rail><RailSection label="Outline" count={2}>hello</RailSection></Rail>);
    expect(slot.querySelector("aside[aria-label='Context']")).not.toBeNull();
    expect(screen.getByText("Outline")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    slot.remove();
  });
});
```

```tsx
// src/components/shell/sidebar-tree.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SidebarTree } from "./sidebar-tree";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const containers = [
  { id: 1, kind: "project", name: "Launch newsletter", slug: "launch-newsletter", progress: { percent: 40, open: 3, done: 2, total: 5, nextTask: null } },
];

describe("SidebarTree", () => {
  it("opens, lists containers, and persists the open state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(containers), { headers: { "content-type": "application/json" } })));
    render(<SidebarTree kind="project" label="Projects" href="/projects" pathname="/projects" />);
    fireEvent.click(screen.getByRole("button", { name: "Show projects" }));
    await waitFor(() => expect(screen.getByText("Launch newsletter")).toBeTruthy());
    expect(JSON.parse(localStorage.getItem("sb.sidebar.open") ?? "{}")).toEqual({ project: true });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/test/tokens.test.ts src/lib/breadcrumb.test.ts src/components/shell`
Expected: FAIL (guard lists paper and brass hits; the modules do not exist).

- [ ] **Step 3: Tokens and classes**

Replace the `@theme` colour block in `src/app/globals.css` with:

```css
  --color-carbon: #0b0b0f;
  --color-layer-1: #121218;
  --color-layer-2: #17171f;
  --color-layer-3: #1d1d26;
  --color-hairline: rgba(255, 255, 255, 0.06);
  --color-hairline-strong: rgba(255, 255, 255, 0.1);
  --color-fg: #eceaf4;
  --color-fg-muted: #9a98a8;
  --color-fg-faint: #5f5e6c;
  --color-violet: #7c5cff;
  --color-violet-bright: #b7a6ff;
  --color-violet-dim: rgba(124, 92, 255, 0.18);
  --color-on-violet: #ffffff;
  --color-success: #6fcf97;
  --color-warn: #f2b441;
  --color-danger: #ef6461;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --shadow-pop: 0 24px 60px -24px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.06);
```

Remove `--shadow-dock`, `--shadow-paper`, every `--color-paper*` and `--color-brass*`, `--color-ink`, `--color-slate*`. Base layer: `body { background: var(--color-carbon) }`, `::selection { background: var(--color-violet-dim) }`, `:focus-visible { outline: 2px solid var(--color-violet) }`. Unlayered classes:

```css
.focus-ring:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-carbon), 0 0 0 4px var(--color-violet); }
.panel { background: var(--color-layer-2); border: 1px solid var(--color-hairline-strong); box-shadow: var(--shadow-pop); }
.pane { background: var(--color-layer-1); border: 1px solid var(--color-hairline); border-radius: var(--radius-md); }
.hairline-row { border-bottom: 1px solid var(--color-hairline); }
.hairline-row:last-child { border-bottom: 0; }
.micro { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fg-faint); }
.glow { position: absolute; width: 640px; height: 640px; border-radius: 9999px; background: radial-gradient(closest-side, var(--color-violet), transparent); opacity: 0.14; pointer-events: none; filter: blur(40px); }
.glow-breathing { animation: glow-breathe 2.4s ease-in-out infinite; }
@keyframes glow-breathe { 0%, 100% { opacity: 0.1; } 50% { opacity: 0.18; } }
@media (prefers-reduced-motion: reduce) { .glow-breathing { animation: none; } }
.kbd { font-family: var(--font-mono); font-size: 10.5px; color: var(--color-fg-faint); border: 1px solid var(--color-hairline-strong); border-radius: 5px; padding: 1px 5px; background: var(--color-layer-2); }
```

Delete `.on-paper`, `.on-paper *` rules and `.doc a`/`.doc pre` paper overrides. `.md` and `.doc` colours: links `var(--color-violet-bright)`, code and pre on `var(--color-layer-3)` with a `hairline` border, blockquote border `hairline-strong`, text inherits `fg`. Keep `.doc` sizes, list rules, and measure. In `src/components/editor/editor.css` remove every `.on-paper` rule; `.rich-editor` background `transparent`, border `0`, padding `0 0 0 40px` (the gutter is now universal since documents no longer sit in a sheet); callouts: note `var(--color-violet-dim)` / `var(--color-violet)`, tip `rgba(111,207,151,.14)` / `var(--color-success)`, warning `rgba(242,180,65,.14)` / `var(--color-warn)`; `th` on `layer-3`; `.on-paper-editor` class removed.

- [ ] **Step 4: Codemod**

```bash
#!/usr/bin/env bash
# scripts/codemod-carbon.sh — one-shot rename of the paper/brass tokens to carbon/violet; kept for the record.
set -euo pipefail
cd "$(dirname "$0")/.."
files=$(grep -rlE 'bg-ink|bg-slate|brass|shadow-dock' src --include='*.tsx' --include='*.ts' || true)
for f in $files; do
  perl -pi -e '
    s/\bhover:bg-slate-2\b/hover:bg-layer-2/g; s/\bhover:bg-slate\b/hover:bg-layer-1/g;
    s/\bbg-slate-2\b/bg-layer-2/g; s/\bbg-slate\b/bg-layer-1/g; s/\bbg-ink\b/bg-carbon/g;
    s/\btext-brass-ink\b/text-on-violet/g; s/\bbg-brass-dim\b/bg-violet-dim/g; s/\bbg-brass\b/bg-violet/g;
    s/\btext-brass\b/text-violet-bright/g; s/\bborder-brass\b/border-violet/g; s/\baccent-brass\b/accent-violet/g;
    s/\bshadow-dock\b/shadow-pop/g;
  ' "$f"
done
echo "codemod applied to $(echo "$files" | wc -w | tr -d " ") files"
```

Run it once. Then by hand: `ProgressRing` colours → `var(--color-violet)`; `border-brass/60` → `border-violet/60`; `bg-brass/10`-style opacities → violet; primary Button = `bg-violet text-on-violet hover:brightness-110`; Chip active = `border-violet/60 bg-violet-dim text-fg`; IconButton active = `text-violet-bright bg-violet-dim`. Remove the `tone` prop from `Button` and `Chip` in `ui.tsx` (and its tests) and every `tone="paper"` usage (Task 3 rebuilds the item page; for this task make the item page compile by dropping `tone` and leaving `DocumentSheet` in place with `bg-layer-1` instead of paper classes; Task 3 removes it).

- [ ] **Step 5: Navigation model**

```ts
// src/components/nav.ts
export type IconName = "today" | "inbox" | "project" | "area" | "resource" | "people" | "activity" | "library" | "archive" | "search" | "capture";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: IconName;
  badge?: "inbox" | "activity";
  section: "brain" | "tools";
  /** Container kind whose active containers appear as a disclosure under this row. */
  tree?: "project" | "area";
}

/** Order is the sidebar order. Every entry has a `g` + letter shortcut. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", shortcut: "g d", icon: "today", section: "brain" },
  { href: "/inbox", label: "Inbox", shortcut: "g i", icon: "inbox", badge: "inbox", section: "brain" },
  { href: "/projects", label: "Projects", shortcut: "g p", icon: "project", section: "brain", tree: "project" },
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area", section: "brain", tree: "area" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource", section: "brain" },
  { href: "/people", label: "People", shortcut: "g e", icon: "people", section: "brain" },
  { href: "/activity", label: "Activity", shortcut: "g t", icon: "activity", badge: "activity", section: "tools" },
  { href: "/library", label: "Library", shortcut: "g l", icon: "library", section: "tools" },
  { href: "/archive", label: "Archive", shortcut: "g x", icon: "archive", section: "tools" },
];

/** Search and Capture are not sidebar rows (the search button and the prompt bar cover them) but keep their shortcuts and palette entries. */
export const SEARCH_ITEM: NavItem = { href: "/search", label: "Search", shortcut: "g s", icon: "search", section: "tools" };
export const CAPTURE_ITEM: NavItem = { href: "/capture", label: "Capture", shortcut: "g c", icon: "capture", section: "tools" };
```

`shortcuts.tsx` and `command-palette.tsx` iterate `[...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM]`. `icons.tsx` maps `today` to `CalendarDays`.

- [ ] **Step 6: Shell components**

```ts
// src/lib/breadcrumb.ts
export interface Crumb { label: string; href?: string }
const TOP: Record<string, string> = { "/today": "Today", "/inbox": "Inbox", "/projects": "Projects", "/areas": "Areas", "/resources": "Resources", "/people": "People", "/activity": "Activity", "/library": "Library", "/archive": "Archive", "/search": "Search", "/capture": "Capture" };
export function crumbsFor(pathname: string): Crumb[] {
  if (TOP[pathname]) return [{ label: TOP[pathname] }];
  if (pathname.startsWith("/c/")) return [{ label: "Projects, areas, resources", href: "/projects" }, { label: "" }];
  if (pathname.startsWith("/items/")) return [{ label: "Library", href: "/library" }, { label: "" }];
  if (pathname.startsWith("/people/")) return [{ label: "People", href: "/people" }, { label: "" }];
  return [{ label: "Home" }];
}
```

```tsx
// src/components/shell/crumb.tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
/** Portals a page-supplied breadcrumb tail into the top bar. `parent` (optional) replaces the route-derived parent crumb. */
export function Crumb({ title, parent }: { title: string; parent?: { label: string; href: string } }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("crumb-slot")); }, []);
  if (!slot) return null;
  return createPortal(
    <>
      {parent && (<><a href={parent.href} className="focus-ring text-fg-muted hover:text-fg rounded-sm">{parent.label}</a><span className="text-fg-faint">/</span></>)}
      <span className="text-fg truncate">{title}</span>
    </>,
    slot,
  );
}
```

(`setSlot` runs inside the effect callback after mount, which the compiler lint allows; it is the documented portal-target pattern.)

```tsx
// src/components/shell/top-bar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelRight } from "lucide-react";
import { crumbsFor } from "@/lib/breadcrumb";
import { IconButton } from "../ui";

export function TopBar({ onMenu, onRail }: { onMenu(): void; onRail(): void }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  const tail = crumbs[crumbs.length - 1];
  return (
    <div className="flex items-center gap-2 h-12 px-4 border-b border-hairline shrink-0">
      <IconButton label="Menu" icon={Menu} onClick={onMenu} className="min-[900px]:hidden" />
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] min-w-0">
        {crumbs.slice(0, -1).map((c) => (
          <span key={c.label} className="flex items-center gap-2">
            {c.href ? <Link href={c.href} className="focus-ring text-fg-muted hover:text-fg rounded-sm">{c.label}</Link> : <span className="text-fg-muted">{c.label}</span>}
            <span className="text-fg-faint">/</span>
          </span>
        ))}
        <span id="crumb-slot" className="flex items-center gap-2 min-w-0 empty:hidden" />
        {tail.label && <span className="text-fg crumb-fallback">{tail.label}</span>}
      </nav>
      <span className="flex-1" />
      <IconButton label="Context" icon={PanelRight} onClick={onRail} className="min-[1180px]:hidden rail-toggle" />
    </div>
  );
}
```

Add to `globals.css`: `#crumb-slot:not(:empty) + .crumb-fallback { display: none; }` and `#rail-slot:empty { display: none; } body:not(:has(#rail-slot > *)) .rail-toggle { display: none; }`.

```tsx
// src/components/shell/rail.tsx
"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Rail({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("rail-slot")); }, []);
  if (!slot) return null;
  return createPortal(<aside aria-label="Context" className="flex flex-col gap-6 p-4 h-full overflow-y-auto">{children}</aside>, slot);
}

export function RailSection({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="micro">{label}</span>
        {count !== undefined && <span className="font-mono text-[11px] text-fg-faint">{count}</span>}
      </div>
      {children}
    </section>
  );
}
```

```tsx
// src/components/shell/toasts.tsx
"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

interface Toast { id: number; text: string; href?: string; hrefLabel?: string; action?: { label: string; onClick(): void } }
const Ctx = createContext<{ push(t: Omit<Toast, "id">): void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 items-end" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="panel rounded-md px-3.5 h-10 flex items-center gap-3 text-[13px]">
            <span>{t.text}</span>
            {t.href && <Link href={t.href} className="focus-ring text-violet-bright rounded-sm">{t.hrefLabel ?? "Open"}</Link>}
            {t.action && <button type="button" onClick={t.action.onClick} className="focus-ring text-violet-bright rounded-sm">{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}
```

`sidebar-tree.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { ProgressRing } from "../tasks/progress-ring";

const KEY = "sb.sidebar.open";
function readOpen(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } }

export function SidebarTree({ kind, label, href, pathname }: { kind: "project" | "area"; label: string; href: string; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ContainerDTO[] | null>(null);
  useEffect(() => { const o = readOpen(); if (o[kind]) setOpen(true); }, [kind]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/containers?kind=${kind}&status=active`, { cache: "no-store" });
        if (res.ok && alive) setItems((await res.json()) as ContainerDTO[]);
      } catch { /* keep previous list */ }
    }
    load();
    window.addEventListener("sb:containers-changed", load);
    return () => { alive = false; window.removeEventListener("sb:containers-changed", load); };
  }, [open, kind]);
  function toggle() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(KEY, JSON.stringify({ ...readOpen(), [kind]: next })); } catch { /* private mode */ }
  }
  return (
    <div>
      <button type="button" aria-label={`Show ${label.toLowerCase()}`} aria-expanded={open} onClick={toggle} className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-sm flex items-center justify-center text-fg-faint hover:text-fg hover:bg-layer-2">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {open && items && (
        <ul className="list-none m-0 p-0 pl-7 pb-1">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} aria-current={pathname === `/c/${c.slug}` ? "page" : undefined} className={`focus-ring flex items-center gap-2 h-8 px-2 rounded-sm text-[13px] truncate ${pathname === `/c/${c.slug}` ? "text-fg bg-layer-3" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`}>
                {kind === "project" && <ProgressRing percent={c.progress.percent} size={14} />}
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          ))}
          {items.length === 0 && <li className="px-2 h-8 flex items-center text-[12.5px] text-fg-faint">None active</li>}
        </ul>
      )}
    </div>
  );
}
```

(`ProgressRing` gains an optional `size` prop, default its current size.) The tree button is positioned inside the nav row, so the sidebar row wrapper is `relative`.

`sidebar-tags.tsx`: fetches `/api/tags?counts=1` on mount (Task 2 adds the parameter; until then the endpoint returns names and the component treats a string array as `{ name, count: 0 }`), renders a `.micro` "Tags" heading, up to ten `Chip href="/search?tag=<name>"` with the count in mono, and an "All tags" link to `/library`.

`sidebar.tsx`: wordmark (`<svg>` 20 px: circle `fill=var(--color-violet)`, inner circle `fill=var(--color-carbon)` r=4), the search button (`onClick={() => window.dispatchEvent(new Event("sb:palette"))}`, `aria-label="Search"`), `<nav aria-label="Main">` with the brain section, a hairline, the tools section, each row a `Link` 36 px with `aria-current`, active `bg-layer-3` with a 2 px violet bar (`before:` pseudo via a `span`), inbox pip (`bg-violet text-on-violet font-mono text-[10px]`), activity danger dot; the two polling effects copied byte for byte from the old `dock.tsx`; then `SidebarTags`; then the status card (`pane` block: dot + "Recording" / "Not recording" / "Paused" linking to `/activity`) and the collapse `IconButton` (`label="Collapse sidebar"` / `"Expand sidebar"`), persisted in `localStorage` key `sb.sidebar.collapsed`, read in an effect. Collapsed: width 64 px, labels hidden, tooltips via `title`. `aria-label`s of the old dock rows are preserved on the new rows.

`app-shell.tsx`:

```tsx
"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { PromptBar } from "./prompt-bar"; // Task 2 creates it; in Task 1 render nothing here (leave the import out until Task 2)
import { ToastProvider } from "./toasts";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="min-h-screen grid grid-cols-[auto_1fr_auto]">
        <Sidebar drawer={drawer} onClose={() => setDrawer(false)} pathname={pathname} />
        <div className="relative flex flex-col min-w-0 min-h-screen">
          <TopBar onMenu={() => setDrawer(true)} onRail={() => setRailOpen((v) => !v)} />
          <main className="flex-1 min-w-0 pb-28">{children}</main>
        </div>
        <div id="rail-slot" className={`w-[280px] border-l border-hairline bg-layer-1 max-[1179px]:fixed max-[1179px]:right-0 max-[1179px]:top-12 max-[1179px]:bottom-0 max-[1179px]:z-30 ${railOpen ? "" : "max-[1179px]:hidden"}`} />
      </div>
    </ToastProvider>
  );
}
```

`layout.tsx`: `<body className="min-h-screen bg-carbon text-fg font-ui"><AppShell>{children}</AppShell><CommandPalette /><Shortcuts /></body>`; delete the `Dock` import and `src/components/dock/`.

- [ ] **Step 7: Run tests, lint, build; commit**

Run: `npm test && npm run lint && npm run build`

```bash
git add -A src scripts/codemod-carbon.sh
git commit -m "feat(shell): carbon tokens, sidebar, breadcrumb bar, rail slot, toasts; dock removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Prompt bar, intent detection, capture hook, tags with counts, thin Today

**Files:**
- Create: `src/lib/intent.ts`, `src/lib/intent.test.ts`, `src/lib/use-capture.ts`, `src/lib/current-container.ts`, `src/components/shell/prompt-bar.tsx`, `src/components/shell/prompt-menu.tsx`, `src/components/shell/prompt-bar.test.tsx`, `src/app/today/page.tsx`, `src/components/today/today-page.tsx`, `src/components/today/partition.ts`, `src/components/today/partition.test.ts`, `src/domain/items/tags.test.ts`
- Modify: `src/components/capture-box.tsx` (use the hook), `src/components/container-editor.tsx` (write the current container), `src/domain/items/index.ts`, `src/app/api/tags/route.ts`, `src/components/shell/app-shell.tsx` (render the bar), `src/components/shell/sidebar-tags.tsx` (use counts)

**Interfaces:**
- Consumes: `useToast`, `AppShell`, `NAV_ITEMS`, `quickParse(input, now)` from `src/domain/tasks/quick-parse.ts`, `isProbablyUrl` from `src/lib/text.ts`, `TaskRow` props, `todayLocal()` from `src/components/activity/format.ts`.
- Produces: `detectIntent(text: string, now?: Date): Intent` where `Intent = { kind: "note"; body: string } | { kind: "link"; url: string } | { kind: "task"; title: string; priority: "high" | "normal"; dueDate: string | null } | { kind: "search"; query: string }`; `useCapture(): { captureNote(body, opts?): Promise<ItemDTO>; captureLink(url, opts?): Promise<ItemDTO | { duplicate: number }>; uploadFiles(files, opts?): Promise<ItemDTO[]> }` with `opts = { tags?: string[]; containerId?: number | null; force?: boolean }`; `currentContainer` store: `setCurrentContainer(id: number | null)`, `useCurrentContainer(): number | null`; `GET /api/tags?counts=1` → `{ name: string; count: number }[]` sorted by count desc then name; `listTagsWithCounts(db)`; `partitionDue(tasks, today): { overdue: TaskDTO[]; today: TaskDTO[] }`.

- [ ] **Step 1: Failing tests**

```ts
// src/lib/intent.test.ts
import { describe, it, expect } from "vitest";
import { detectIntent } from "./intent";
const now = new Date("2026-09-22T10:00:00");
describe("detectIntent", () => {
  it("links", () => { expect(detectIntent(" https://example.com/x ")).toEqual({ kind: "link", url: "https://example.com/x" }); });
  it("tasks with + and /task", () => {
    expect(detectIntent("+ Call the bank fri", now)).toEqual({ kind: "task", title: "Call the bank", priority: "normal", dueDate: "2026-09-25" });
    expect(detectIntent("/task !Ship it", now)).toEqual({ kind: "task", title: "Ship it", priority: "high", dueDate: null });
  });
  it("search with ? and /search", () => {
    expect(detectIntent("?tax forms")).toEqual({ kind: "search", query: "tax forms" });
    expect(detectIntent("/search tax")).toEqual({ kind: "search", query: "tax" });
  });
  it("notes by default and with /note", () => {
    expect(detectIntent("Remember the milk")).toEqual({ kind: "note", body: "Remember the milk" });
    expect(detectIntent("/note https://not-a-link.example is text")).toEqual({ kind: "note", body: "https://not-a-link.example is text" });
  });
});
```

(Confirm the exact `quickParse` date output for "fri" from `quick-parse.test.ts` and match it.)

```ts
// src/components/today/partition.test.ts
import { describe, it, expect } from "vitest";
import { partitionDue } from "./partition";
const t = (id: number, dueDate: string | null) => ({ id, title: `t${id}`, notes: "", status: "open" as const, priority: "normal" as const, dueDate, containerId: null, sourceItemId: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "" });
describe("partitionDue", () => {
  it("splits overdue and today, ignores future and undated", () => {
    const r = partitionDue([t(1, "2026-09-20"), t(2, "2026-09-22"), t(3, "2026-09-23"), t(4, null)], "2026-09-22");
    expect(r.overdue.map((x) => x.id)).toEqual([1]);
    expect(r.today.map((x) => x.id)).toEqual([2]);
  });
});
```

```ts
// src/domain/items/tags.test.ts — follow the fixture pattern in src/domain/items/index.test.ts (in-memory db helper)
it("lists tags with counts, most used first", () => {
  // create three items, tag two with "work" and one with "home"
  expect(listTagsWithCounts(db)).toEqual([{ name: "work", count: 2 }, { name: "home", count: 1 }]);
});
```

```tsx
// src/components/shell/prompt-bar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PromptBar } from "./prompt-bar";
import { ToastProvider } from "./toasts";
import { setCurrentContainer } from "@/lib/current-container";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/inbox" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCurrentContainer(null); });

function mockFetch(body: unknown, status = 201) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function type(text: string) {
  const input = screen.getByRole("textbox", { name: "Ask, capture, or add a task" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("PromptBar", () => {
  it("adds a task in the current container and toasts", async () => {
    const fetchFn = mockFetch({ id: 9, title: "Call the bank" });
    setCurrentContainer(4);
    render(<ToastProvider><PromptBar /></ToastProvider>);
    type("+ Call the bank");
    await waitFor(() => expect(screen.getByText("Task added")).toBeTruthy());
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Call the bank", containerId: 4 });
  });
  it("captures a note to the inbox", async () => {
    const fetchFn = mockFetch({ id: 12, type: "note", title: "Remember" });
    render(<ToastProvider><PromptBar /></ToastProvider>);
    type("Remember the milk");
    await waitFor(() => expect(screen.getByText("Captured to Inbox")).toBeTruthy());
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe("/api/items");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/items/12");
  });
  it("navigates for search", () => {
    render(<ToastProvider><PromptBar /></ToastProvider>);
    type("?tax");
    expect(push).toHaveBeenCalledWith("/search?q=tax");
  });
  it("shows the server error and keeps the text", async () => {
    mockFetch({ error: "Body required" }, 400);
    render(<ToastProvider><PromptBar /></ToastProvider>);
    type("x");
    await waitFor(() => expect(screen.getByText("Body required")).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Ask, capture, or add a task" }) as HTMLInputElement).value).toBe("x");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/intent.test.ts src/components/today src/components/shell/prompt-bar.test.tsx src/domain/items/tags.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement intent, store, capture hook, tags**

```ts
// src/lib/intent.ts
import { isProbablyUrl } from "./text";
import { quickParse } from "@/domain/tasks/quick-parse";
export type Intent =
  | { kind: "note"; body: string }
  | { kind: "link"; url: string }
  | { kind: "task"; title: string; priority: "high" | "normal"; dueDate: string | null }
  | { kind: "search"; query: string };
export function detectIntent(raw: string, now: Date = new Date()): Intent {
  const text = raw.trim();
  if (text.startsWith("/note ")) return { kind: "note", body: text.slice(6).trim() };
  if (text.startsWith("/search ")) return { kind: "search", query: text.slice(8).trim() };
  if (text.startsWith("?")) return { kind: "search", query: text.slice(1).trim() };
  if (text.startsWith("/task ") || text.startsWith("+")) {
    const parsed = quickParse(text.replace(/^\/task\s+|^\+\s*/, ""), now);
    return { kind: "task", title: parsed.title, priority: parsed.priority, dueDate: parsed.dueDate };
  }
  if (isProbablyUrl(text)) return { kind: "link", url: text };
  return { kind: "note", body: text };
}
```

```ts
// src/lib/current-container.ts
import { useSyncExternalStore } from "react";
let current: number | null = null;
const listeners = new Set<() => void>();
export function setCurrentContainer(id: number | null) { current = id; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useCurrentContainer(): number | null { return useSyncExternalStore(subscribe, () => current, () => null); }
```

`container-editor.tsx`: `useEffect(() => { setCurrentContainer(c.id); return () => setCurrentContainer(null); }, [c.id]);`.

`src/lib/use-capture.ts`: move the `readError` helper and the two request shapes out of `capture-box.tsx` verbatim: `captureNote(body, opts)` posts `{ type: "note", body, tags, containerId }`; `captureLink(url, opts)` posts `{ type: "link", url, tags, containerId, force }` and returns `{ duplicate: existingId }` on 409; `uploadFiles(files, opts)` loops the `FormData` upload. Each throws `Error(message)` on failure. `capture-box.tsx` calls the hook and keeps its state, UI, duplicate handling, and `sb:inbox-changed` dispatch exactly as now.

`listTagsWithCounts(db)`: `select tags.name, count(item_tags.item_id) from tags left join item_tags … group by tags.id order by count desc, name asc`. `/api/tags` returns counts when `?counts=1`, names otherwise.

- [ ] **Step 4: Prompt bar**

`prompt-menu.tsx`: a `panel` list of four entries `{ word: "note" | "link" | "task" | "search", label, hint }` with `role="listbox"`, `aria-activedescendant`, arrow keys, Enter selects, Escape closes; renders above the bar (absolute, `bottom-full mb-2`).

`prompt-bar.tsx` (client):

- State: `text`, `multiline`, `busy`, `error`, `menuOpen`, `pendingItemId` (for the breathing glow).
- `intent = detectIntent(text)`; mode chip shows `Note | Link | Task | Search` with icons `FileText | Link2 | Square | Search`.
- `<form aria-label="Ask, capture, or add a task" onSubmit={submit}>` containing `<div className="glow -bottom-80 left-1/2 -translate-x-1/2 ${pendingItemId ? "glow-breathing" : ""}" />` inside a `relative` wrapper, the chip, the input (`<input aria-label="Ask, capture, or add a task">`; when `multiline`, a `<textarea>` with the same label, rows up to 5), a `<Kbd>⏎</Kbd>`, and the submit button (`aria-label="Send"`, `bg-violet text-on-violet rounded-full w-8 h-8`, disabled when empty or busy).
- Keys: Enter submits (in the textarea, plain Enter submits and Shift+Enter inserts a newline); `Shift+Enter` in the input switches to multiline; typing `/` as the first character opens the menu; Escape closes the menu or blurs. A window `keydown` listener focuses the input on `c` when the target is not an input, textarea, select, or contenteditable (same `isTyping` test as `shortcuts.tsx`).
- `submit`: by `intent.kind`: `task` → `POST /api/tasks` `{ title, priority, dueDate, containerId: useCurrentContainer() }` → toast "Task added" with action Undo (DELETE `/api/tasks/<id>`) → `window.dispatchEvent(new Event("sb:tasks-changed"))`; `note` → `captureNote(body)` → toast "Captured to Inbox" `href=/items/<id>`; `link` → `captureLink(url)`; on `{ duplicate }` toast "Already captured" `href=/items/<existingId>`, else toast "Link captured" and set `pendingItemId` and poll `GET /api/items/<id>` every 2 s until `status !== "pending"` or 60 s; `search` → `router.push('/search?q=' + encodeURIComponent(query))`. After a successful submit clear the text, keep focus; both note and link paths dispatch `sb:inbox-changed`. On error set `error` to the message and keep the text; a Retry button re-runs `submit`.
- Paste/drop of files → `uploadFiles(files)` → toast "N files captured".
- Hidden on `/capture` (`usePathname`).
- Below 900 px the placeholder is "Ask or capture".

`app-shell.tsx` renders `<PromptBar />` inside the main column (absolute bottom, `left-4 right-4 bottom-4`) after `<main>`.

- [ ] **Step 5: Thin Today**

```ts
// src/components/today/partition.ts
import type { TaskDTO } from "@/lib/dto";
export function partitionDue(tasks: TaskDTO[], today: string): { overdue: TaskDTO[]; today: TaskDTO[] } {
  const open = tasks.filter((t) => t.status === "open" && t.dueDate);
  return { overdue: open.filter((t) => t.dueDate! < today), today: open.filter((t) => t.dueDate === today) };
}
```

`src/app/today/page.tsx` (server): `const today = todayLocal(); const tasks = listTasks(db, { containerId: undefined, status: "open" }).map(serializeTask); const day = <the same DTO the /api/activity/day route builds for today, call its domain function directly>`; renders `<TodayPage today={today} tasks={tasks} meetings={day.meetings} />`.

`today-page.tsx` (client): `<Crumb title="Today" />`; header: the date numeral (`font-doc text-[96px] leading-[0.9] font-medium`), beside it the weekday (`text-[18px]`) and "22 September" (`text-fg-muted`) stacked, then a mono line "`{n} due today, {m} overdue`" (or "Nothing due today"). Then a two-column grid (`min-[1100px]:grid-cols-2 gap-6`): a `pane` "Due" with a `.micro` label, overdue tasks first (row date in `text-danger`), then today's (`text-warn`), rendered with `TaskRow` wired to the existing task PATCH/DELETE handlers copied from `task-list.tsx`'s row callbacks (toggle, rename, due, priority, drop, delete; no drag); listens to `sb:tasks-changed` and refetches `/api/tasks?status=open`. A `pane` "Meetings" listing `meetings` sorted by `startsAt` with `HH:MM` in mono and the title, "No meetings today" when empty. Empty Due: "Nothing due. Add a task below with +".

- [ ] **Step 6: Run tests, lint, build; commit**

```bash
git add -A src
git commit -m "feat(shell): prompt bar with intent detection, capture hook, tag counts, Today

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Documents on carbon with rails; projects and container pages on panes

**Files:**
- Create: `src/lib/headings.ts`, `src/lib/headings.test.ts`, `src/components/document/item-rail.tsx`, `src/components/containers/container-rail.tsx`
- Modify: `src/components/item-editor.tsx`, `src/components/item-editor.test.tsx`, `src/components/document/metadata-strip.tsx`, `src/components/document/tag-chips.tsx`, `src/components/container-editor.tsx`, `src/components/tasks/project-card.tsx`, `src/components/editor/rich-editor.tsx`, `src/components/editor/editor.css`, `src/components/people/*` or `person-editor.tsx` (only if it used paper classes)
- Delete: `src/components/document/document-sheet.tsx`

**Interfaces:**
- Consumes: `Rail`, `RailSection`, `Crumb`, `ItemDTO`, `ContainerDTO`.
- Produces: `headings(md: string): { level: 1 | 2 | 3; text: string }[]`; `ItemRail({ item, body, onScrollTo(text), onMove() })`; `ContainerRail({ container, taskCount, itemCount })`; `RichEditor` loses `variant` (single carbon look).

- [ ] **Step 1: Failing headings test**

```ts
// src/lib/headings.test.ts
import { describe, it, expect } from "vitest";
import { headings } from "./headings";
describe("headings", () => {
  it("collects levels 1 to 3 and skips code fences", () => {
    const md = "# Title\n\ntext\n\n## Part one\n\n```\n# not a heading\n```\n\n### Detail\n\n#### too deep\n";
    expect(headings(md)).toEqual([{ level: 1, text: "Title" }, { level: 2, text: "Part one" }, { level: 3, text: "Detail" }]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/headings.ts
export function headings(md: string): { level: 1 | 2 | 3; text: string }[] {
  const out: { level: 1 | 2 | 3; text: string }[] = [];
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length as 1 | 2 | 3, text: m[2].replace(/[*_`]/g, "") });
  }
  return out;
}
```

`item-rail.tsx`: `<Rail>` with `RailSection "Outline"` (count = headings; each a `button` indented by level, `onClick={() => onScrollTo(text)}`; "No headings yet" when empty), `RailSection "Details"` (rows label/value: Type with `TypeIcon`, Status with `StatusDot` and the word, Home as the container `Chip` with `onClick={onMove}` or "Inbox", Created and Updated with `formatDate` in mono, Source domain for links), `RailSection "Tags"` (chips, "No tags" when empty).

`item-editor.tsx`: delete the `DocumentSheet` wrapper; the page becomes `<div className="max-w-[760px] mx-auto px-6 py-8">` with the title input (`font-doc text-[40px] leading-[1.1] font-medium bg-transparent outline-none focus-ring w-full`), the `MetadataStrip` (restyled: `text-fg-muted`, separators `bg-hairline-strong`), hairline, source line (`text-violet-bright underline underline-offset-[3px]`), preview (`doc md`) or `RichEditor` (no `variant`), the extracted-text details on `layer-1`. Mount `<Crumb title={title || "Untitled"} />` and `<ItemRail item={item} body={body} onScrollTo={scrollToHeading} onMove={() => setMovePicker(true)} />`. `scrollToHeading(text)` finds the first `h1, h2, h3` in the editor DOM whose `textContent` matches and calls `scrollIntoView({ block: "start", behavior: "smooth" })` (guard `matchMedia("(prefers-reduced-motion: reduce)")` → `"auto"`). Every handler stays; `Chip tone` and `Button tone` props are gone.

`rich-editor.tsx`: remove `variant` and `variantClass`; the editor class is `doc rich-editor`; the fallback Textarea keeps `className`. `editor.css`: as Task 1 left it, plus `.rich-editor { min-height: 40vh }`.

`container-rail.tsx`: `RailSection "Details"` (Kind, Deadline or Category, Status, Items count, Tasks open/done), `RailSection "Pinned links"` (the container's `pinnedLinks` as `Chip href` with the domain; "None pinned"). `container-editor.tsx` mounts it and `<Crumb title={c.name} parent={{ label: KIND_LABEL[c.kind] + "s", href: `/${c.kind}s` }} />` (Projects, Areas, Resources); the hero `section` becomes `pane p-6`; tasks, links, notes sections unchanged in behaviour.

`project-card.tsx`: `pane p-5 hover:border-hairline-strong`; ring violet.

- [ ] **Step 3: Update tests, run, commit**

`item-editor.test.tsx`: assertions on the sheet or `tone` removed; one new case: the rail's Outline lists "Part one" when the body contains `## Part one` (render with a `#rail-slot` div in `document.body`).

```bash
git add -A src
git commit -m "feat(shell): documents on carbon with item and container rails

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Sweep, palette, README

**Files:**
- Modify: `src/components/{inbox-processor,search-panel,capture-box,capture-screen,container-list,people-picker,container-picker,command-palette,complete-project-dialog,person-editor,new-container-form,new-person-form}.tsx`, `src/components/activity/*.tsx`, `src/app/**/page.tsx` as needed, `README.md`

- [ ] **Step 1: Sweep rules**

- Inbox focus card, search result cards, the capture box, the activity status strip, the rules drawer, the person editor profile block: `pane`.
- Pickers, palette, dialogs, the prompt menu: `panel` (`shadow-pop`).
- Page titles use `PageHeader` unchanged (Manrope 22); the Today page keeps its numeral.
- The palette adds "Today" through `NAV_ITEMS` automatically; verify its row hints.
- `mark` in search results: `bg-violet-dim text-fg`.
- Remove any leftover `pb-28` assumptions that were for the dock (the shell's `<main>` keeps `pb-28` for the prompt bar).
- README `### Design`: "The interface is a carbon workspace: a sidebar that shows the whole brain, a breadcrumb bar, a context rail beside documents, and one prompt bar that captures, adds tasks, and searches from any page. One violet accent, serif titles, small mono labels. Motion is limited to state changes and respects reduced-motion settings."

- [ ] **Step 2: Verify and commit**

Run: `npm test && npm run lint && npm run build`; `grep -rn "uppercase\|tracking-wider\|·\|tone=\|on-paper\|DocumentSheet" src --include='*.tsx'` must be empty. The controller screenshots Today, Inbox, Projects, a project page, a note with the rail, Search, Activity, the prompt bar `/` menu, and a toast at 1440 and 900 px.

```bash
git add -A src README.md
git commit -m "feat(shell): pages on carbon panes, README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: tokens (2) → Task 1; type (3) → Tasks 1 and 3 (`.micro`, display sizes); app shell, sidebar, top bar, rail, prompt bar, toasts, removal (4) → Tasks 1 and 2; pages on carbon (5) → Tasks 2 (Today), 3 (item, container, projects), 4 (sweep); migration (6) → Task 1's codemod and guard; accessibility (7) → constraints and the components' `aria` attributes; testing (8) → each task; order (9) matches.
- Placeholders: none; the `/api/activity/day` domain call in Task 2 step 5 says to call the same function the route uses (read `src/app/api/activity/day/route.ts`).
- Type consistency: `Crumb`, `Rail`, `RailSection`, `useToast().push`, `detectIntent`, `useCapture`, `setCurrentContainer`/`useCurrentContainer`, `partitionDue`, `headings`, `ItemRail`, `ContainerRail`, `NAV_ITEMS.section/tree`, `SEARCH_ITEM`, `CAPTURE_ITEM` are named identically across tasks.
