# Carbon shell: sidebar, rail, prompt bar

Date: 2026-09-22. Slice 1 of the "Carbon" direction, which replaces the "paper on a dark desk" language from `2026-09-21-design-language-design.md`. Later slices: Today and tasks (2), Connections (3), Assistant (4). Everything functional stays; this spec changes the app's frame, its tokens, and how every page sits inside the frame.

## 1. Purpose

The app reads as a set of pages behind a floating dock. The target is a workspace: a persistent sidebar that shows the whole brain at a glance (destinations, projects, areas, tags), a main pane with a breadcrumb, an optional context rail beside documents, and one prompt bar at the bottom of the main pane that captures, adds tasks, and searches without leaving the page. The look is carbon black with one violet accent and a soft glow, serif display type for titles, and small tracked mono labels for section names.

## 2. Tokens

Defined in `@theme` in `src/app/globals.css`. The paper and brass tokens are removed; `bg-ink` becomes `bg-carbon`.

| Token | Value | Use |
|---|---|---|
| `--color-carbon` | `#0B0B0F` | page ground |
| `--color-layer-1` | `#121218` | sidebar, rail, panels |
| `--color-layer-2` | `#17171F` | inputs, hover rows, popovers |
| `--color-layer-3` | `#1D1D26` | pressed, selected rows, code |
| `--color-hairline` | `rgba(255,255,255,0.06)` | rules |
| `--color-hairline-strong` | `rgba(255,255,255,0.10)` | focused or hovered borders |
| `--color-fg` | `#ECEAF4` | primary text |
| `--color-fg-muted` | `#9A98A8` | secondary text |
| `--color-fg-faint` | `#5F5E6C` | tertiary text, micro labels |
| `--color-violet` | `#7C5CFF` | accent fills, active nav, primary button, focus ring |
| `--color-violet-bright` | `#B7A6FF` | accent text at small sizes, links |
| `--color-violet-dim` | `rgba(124,92,255,0.18)` | accent tint, selection |
| `--color-on-violet` | `#FFFFFF` | text on a violet fill |
| `--color-success` | `#6FCF97` | done, recording |
| `--color-warn` | `#F2B441` | due today, attention |
| `--color-danger` | `#EF6461` | overdue, destructive |
| `--radius-sm/md/lg` | 6 / 10 / 14 px | controls / panels / popovers |
| `--shadow-pop` | `0 24px 60px -24px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.06)` | popovers, palette |

Semantic classes: `.panel` = layer-2 with `shadow-pop` (popovers); `.pane` = layer-1 with a hairline border (sidebar, rail, the Today columns, project cards); `.hairline-row` unchanged; `.glow` = a 640 px radial violet gradient at 14 % opacity fading to transparent, positioned absolutely, `pointer-events: none`; `.glow-breathing` animates opacity 10 % to 18 % over 2.4 s (disabled under reduced motion); `.micro` = Geist Mono 10.5 px, uppercase, letter-spacing 0.14 em, `fg-faint`. `.micro` is the only uppercase text in the app and is used only for section labels inside the rail, the sidebar group headings, and the Today page's section names.

## 3. Type

- Manrope stays for UI at 12, 13, 14, 16, 18.
- Newsreader for display: page titles 32/1.15 medium, document titles 40/1.1 medium, the Today date numeral 96/0.9 medium with the month in Manrope 14 muted beside it.
- Geist Mono for counts, dates, shortcuts, code, and `.micro` labels.
- Sentence case everywhere except `.micro`. No middle dots.

## 4. App shell

`src/components/shell/app-shell.tsx` wraps every page in `src/app/layout.tsx`. A CSS grid: sidebar 264 px, main pane flexible, rail 280 px. The rail column exists only when the current page mounts a `<Rail>`: the shell renders an empty `<div id="rail-slot">` as the third grid column, `<Rail>` portals its content into it (`createPortal` after mount), and the column is hidden while empty with `#rail-slot:empty { display: none }`. No React state is shared between page and shell for this. Below 1180 px the rail collapses into a toggle button in the top bar that opens it as an overlay. Below 900 px the sidebar becomes an off-canvas drawer opened by a menu button in the top bar, and the prompt bar shortens its placeholder to "Ask or capture".

### Sidebar (`src/components/shell/sidebar.tsx`)

Top to bottom:

1. Wordmark "Second brain" in Newsreader 18 with a 20 px violet mark (a filled circle with a smaller carbon circle inside, drawn as SVG).
2. A search button styled as an input: magnifier, "Search or jump to", a `⌘K` kbd. Clicking dispatches `sb:palette`.
3. Navigation, `<nav aria-label="Main">`, rows 36 px, icon 18 px, label 13 px, active row `layer-3` with a 2 px violet bar on the left and `aria-current="page"`:
   - Today (`/today`, `g d`), Inbox (`/inbox`, count pip in violet), Projects, Areas, Resources, People;
   - a hairline;
   - Activity (danger dot when the helper is not recording), Library, Archive.
   - Search and Capture are not rows: search is the button above, capture is the prompt bar. Their `g s` and `g c` shortcuts and palette entries stay.
4. Under Projects and Areas, a disclosure caret reveals the active containers of that kind (from `/api/containers?kind=project|area`, fetched once on mount, refetched on `sb:containers-changed`), each a 32 px row linking to `/c/<slug>`; a project row shows its progress ring at 14 px. Open state is per kind, persisted in `localStorage` key `sb.sidebar.open`.
5. `.micro` heading "Tags" and the ten most used tags as chips with counts (from `/api/tags?counts=1`), each linking to `/search?tag=<name>`; "All tags" links to `/library`. Tags with no items are not shown.
6. Bottom card: helper state ("Recording" with a success dot, "Not recording" with a danger dot, "Paused" with a warn dot) linking to `/activity`, and a collapse button (chevrons) that narrows the sidebar to 64 px showing icons only, persisted in `localStorage` key `sb.sidebar.collapsed`. Collapsed rows show their label in a tooltip.

The inbox count and helper state polls move from the dock into the sidebar unchanged (same URLs, same intervals).

### Top bar (`src/components/shell/top-bar.tsx`)

48 px, hairline below. Left: the breadcrumb. Right: a slot for page actions and the rail toggle. The breadcrumb is derived from the route with a small map (`/inbox` → Inbox; `/projects` → Projects; `/c/<slug>` → kind label then the container title; `/items/<id>` → Library then the item title; `/people/<slug>` → People then the name; `/search` → Search; `/activity` → Activity; `/today` → Today). Pages that know a title render `<Crumb title="…" />`, which portals the title into the bar's `#crumb-slot`, so the bar never shows an id; while the slot is empty the bar shows the route-derived label. The last crumb is `fg`, earlier crumbs are `fg-muted` links, separated by a `/` in `fg-faint`.

Page actions: `PageHeader` keeps rendering the title inside the page; its `actions` are rendered in the page as today. The top bar's slot is for shell-level actions only (rail toggle, sidebar menu on narrow screens).

### Rail (`src/components/shell/rail.tsx`)

`<aside aria-label="Context">`, `pane`, 280 px, scrolls independently. Sections are `<RailSection label>` with a `.micro` label and a count on the right. The item page mounts a rail with:

- **Outline**: the document's headings (levels 1 to 3) parsed from the body markdown with a small `headings(md)` helper; clicking scrolls the editor's matching heading into view (matched by text).
- **Details**: type, status word with its dot, home (the container chip, opens the move picker), created and updated dates in mono.
- **Tags**: the item's tags as chips (read-only here; editing stays in the metadata strip).

Container pages mount a rail with **Details** (kind, deadline or category, item and task counts) and **Pinned links** (the starred links). Slice 3 adds Linked from and Mentioned here.

### Prompt bar (`src/components/shell/prompt-bar.tsx`)

Fixed to the bottom of the main pane (not the rail), 56 px tall with 16 px margins, `layer-2`, hairline, `radius-lg`, a `.glow` behind it. Left: a mode chip (icon plus word) showing the detected intent; middle: a single-line input, placeholder "Ask, capture, or add a task"; right: a `⏎` kbd and a submit button (violet circle with an arrow) that enables when the input is non-empty. `Shift+Enter` turns the input into a textarea that grows to five lines (multi-line note). Pressing `c` anywhere outside an input focuses it; `Escape` blurs and clears the mode menu.

Intent detection, `detectIntent(text): { kind: "note" | "link" | "task" | "search"; payload }` in `src/lib/intent.ts`:

- text that is a single URL (after trim) → `link`;
- text starting with `+` or `/task ` → `task`, payload from `quickParse` (`!` priority, trailing day or date);
- text starting with `?` or `/search ` → `search`;
- text starting with `/note ` → `note`;
- anything else → `note`.

Typing `/` at the start opens a small `panel` menu above the bar with Note, Link, Task, Search (arrow keys, Enter, Escape), the same keyboard model as the editor's slash menu. Choosing one inserts its `/word ` prefix.

Submit:

- `note` → `POST /api/items` `{ type: "note", body }` (title derived server-side as today) → toast "Captured to Inbox" with an "Open" link to the item;
- `link` → `POST /api/items` `{ type: "link", sourceUrl }` → toast "Link captured" with "Open"; the glow breathes until `GET /api/items/<id>` reports a status other than `pending` (poll every 2 s, stop after 60 s);
- `task` → `POST /api/tasks` with the parsed title, priority, and due date; container is the current container when the route is `/c/<slug>` (the container page writes its id into a tiny external store in `src/lib/current-container.ts` from an effect, and the bar reads it with `useSyncExternalStore`), else null (Inbox) → toast "Task added" with "Undo" (DELETE the task) and dispatch `sb:tasks-changed`;
- `search` → navigate to `/search?q=<text>`.

Files pasted or dropped on the bar upload through `POST /api/upload` exactly as the capture page does; the upload logic is extracted from `capture-box.tsx` into `src/lib/use-capture.ts` (`useCapture(): { captureText, captureUrl, uploadFiles, pending }`) and both the page and the bar use it. Errors show in the bar as a danger line under the input with the server message and a Retry action; nothing is silently dropped. The bar is not rendered on `/capture` (the page's own box stays) nor inside the command palette overlay.

Toasts: `src/components/shell/toasts.tsx`, a `ToastProvider` with `useToast()`; a toast is a `panel` at the bottom right above the bar, 5 s, with one optional action, `role="status"`.

### Removed

`src/components/dock/` is deleted. `g` shortcuts, the palette, and `/capture` stay. `nav.ts` gains Today and drops the dock groups in favour of `section: "brain" | "tools"`.

## 5. Pages on carbon

- **Item page**: the paper sheet goes. The document sits on carbon, max width 760 px, centred in the main pane, with the rail beside it. Title in Newsreader 40, then the metadata strip (type, home chip, tags with "Add tag", people with "Add person", created), a hairline, the source line for links and files, and the body. The editor on carbon: `.doc` text `fg`, links `violet-bright`, code on `layer-3`, callouts tinted `violet-dim` (note), success 14 % (tip), warn 14 % (warning) with the icon. Handles keep the 40 px gutter. `DocumentSheet`, the `on-paper` classes, and the `tone` props on `Button` and `Chip` are removed.
- **Today** (thin, slice 2 extends it): a `/today` page with the date numeral, "Tuesday" and "22 September" beside it in Manrope, a line "3 due today, 1 overdue" in mono, then two `pane` columns: **Due** (open tasks with `dueDate` on or before today from `GET /api/tasks?status=open`, overdue rows in danger, today in warn, each with the existing task row) and **Meetings** (today's calendar entries from `GET /api/activity/day?date=<today>`, each with time and title). Empty states are single sentences.
- **Projects**: cards become `pane` tiles with the progress ring in violet.
- **Container pages**: the hero, tasks, links, and notes sections use `pane` blocks; the page mounts the container rail.
- **Inbox, Library, Search, People, Archive, Activity**: re-skinned by the codemod (brass to violet, ink to carbon); focus cards and search results use `pane`.
- **Command palette**: `panel`, `shadow-pop`, gains "Today".

## 6. Migration

- Codemod (`scripts/codemod-carbon.sh`, committed): `bg-ink`→`bg-carbon`, `bg-slate`→`bg-layer-1`, `bg-slate-2`→`bg-layer-2`, `hover:bg-slate-2`→`hover:bg-layer-2`, `text-brass`→`text-violet-bright`, `bg-brass`→`bg-violet`, `bg-brass-dim`→`bg-violet-dim`, `border-brass`→`border-violet`, `text-brass-ink`→`text-on-violet`, `accent-brass`→`accent-violet`. Paper classes (`bg-paper*`, `text-paper*`, `border-paper*`, `on-paper`, `shadow-paper`, `tone=`) are removed by hand with the sheet.
- `src/test/tokens.test.ts` extends its retired list with `brass`, `paper`, `slate`, `bg-ink`, `shadow-dock`, `on-paper`.
- Behaviour freeze: no handler, fetch, autosave, or keyboard logic changes outside the shell components and the capture hook extraction; every `aria-label`, `title`, and `disabled` condition preserved.

## 7. Accessibility and quality floor

- Contrast: `fg` on carbon 16:1, `fg-muted` 7:1, `violet-bright` on carbon 8.6:1, `on-violet` on violet 5.4:1 (buttons at 14 px medium), `fg-faint` used only at 10.5 px mono labels and never for body text.
- Focus ring: `0 0 0 2px carbon, 0 0 0 4px violet` on every interactive element.
- Sidebar `<nav aria-label="Main">`, rail `<aside aria-label="Context">`, prompt bar `<form aria-label="Ask, capture, or add a task">`, toasts `role="status"`.
- Reduced motion disables the glow breathing and press scaling.
- Hydration deterministic: the sidebar's persisted state is read in an effect, never during render.

## 8. Testing

Unit (jsdom): `detectIntent` cases (URL, `+`, `/task`, `?`, `/search`, `/note`, plain); `headings(md)`; breadcrumb derivation for each route shape; `Rail` sets and clears `hasRail`; sidebar disclosure persists to `localStorage`; prompt bar submit paths with mocked `fetch` for note, link, task (with and without a current container), search; `useCapture` upload path; Today partition of due and overdue; `listTagsWithCounts`. The existing `dock-more.test.tsx` and dock tests are deleted with the dock. Screenshots at 1440 and 900 px: Today, Inbox, Projects, a project page, a note with the rail, Search, Activity, the prompt bar's `/` menu, a toast.

## 9. Implementation order

1. Tokens, codemod, guard test; app shell with sidebar, top bar, rail infrastructure, toasts; dock deleted; `nav.ts` updated.
2. Prompt bar with intent detection, the capture hook extraction, tags-with-counts API, the thin Today page.
3. Item page on carbon with the item rail and outline; container rail; projects and container pages on `pane`.
4. Sweep of the remaining pages, README design note, screenshots.
