# Design language: paper on a dark desk

Date: 2026-09-21. Replaces section 11 "Visual direction" of `2026-09-12-second-brain-design.md` and the design system in `2026-09-12-ui-polish.md`. Everything functional stays; this spec changes how the app looks and how documents are edited.

## 1. Purpose

The current look is a generic dark UI with one cyan accent. Notes feel like a form: a title, tag and people inputs, then a small box. This spec gives the app an identity grounded in the product: a dark desk (the chrome) with paper documents on it (notes, journal entries, meeting transcripts). Editing becomes a block editor with visible handles, and the dock becomes a crafted object rather than a translucent pill.

## 2. Tokens

Defined in `src/app/globals.css` `@theme`; every component uses tokens, never raw hex.

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#0F1218` | page ground |
| `--color-slate` | `#171B23` | raised surfaces on ink: dock, panels, menus, inputs |
| `--color-slate-2` | `#1E232D` | hover and pressed on slate |
| `--color-hairline` | `rgba(255,255,255,0.08)` | rules and borders on ink |
| `--color-hairline-strong` | `rgba(255,255,255,0.14)` | focused or hovered borders on ink |
| `--color-fg` | `#EDEBE4` | primary text on ink (warm white) |
| `--color-fg-muted` | `#A3A8B4` | secondary text on ink |
| `--color-fg-faint` | `#6B7080` | tertiary text on ink |
| `--color-paper` | `#F4F0E8` | document sheet |
| `--color-paper-2` | `#ECE7DD` | paper hover rows, code blocks on paper |
| `--color-paper-rule` | `rgba(15,18,24,0.10)` | rules on paper |
| `--color-paper-fg` | `#1B1F27` | primary text on paper |
| `--color-paper-muted` | `#5B6070` | secondary text on paper |
| `--color-brass` | `#E0A93C` | accent: active, selected, due, primary action |
| `--color-brass-dim` | `rgba(224,169,60,0.16)` | accent tint |
| `--color-brass-ink` | `#2A1F07` | text on a brass fill |
| `--color-success` | `#7FB88A` | done, healthy |
| `--color-warn` | `#D9A441` | due today, attention |
| `--color-danger` | `#D66A5C` | overdue, destructive |
| `--radius-sm/md/lg` | 6 / 10 / 16 px | controls / panels / sheets |
| `--shadow-dock` | `0 20px 50px -20px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08)` | dock and menus |
| `--shadow-paper` | `0 30px 80px -40px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.04)` | the sheet |

Semantic classes: `.on-paper` scopes paper text colours (`color: var(--color-paper-fg)`, links in brass-ink darkened, selection in `--color-brass-dim`). `.hairline-row` replaces bordered rows in lists (bottom hairline only, no box). `.panel` becomes slate with the dock shadow. `.frost` is removed.

## 3. Type

- **Manrope** (UI): weights 400, 500, 600. Sizes: 12, 13, 14 (base), 16, 18, 22 (page titles). Letter-spacing 0 at body sizes, `-0.01em` at 18 and above.
- **Newsreader** (documents on paper): opsz axis on, weights 400 and 500, italic available. Document title 40/1.1 medium; body 17/1.6; h1 30/1.2, h2 24/1.25, h3 19/1.3; blockquote and callout body 17 italic-capable; measure 68ch.
- **Geist Mono** stays for counts, dates, shortcuts, code (code on paper at 15/1.5 in `paper-2` blocks).
- Loaded with `next/font/google` (Manrope, Newsreader) with `display: swap` and CSS variables `--font-ui`, `--font-doc`, `--font-mono`.
- No uppercase tracked labels; sentence case everywhere; no middle-dot strings (the metadata strip uses spacing and hairline separators, not characters).

## 4. Chrome on ink

- Page header: title in Manrope 22 medium, meta in 13 muted; actions right-aligned; no boxed cards.
- Lists: `hairline-row` rows 44 px, hover `slate-2` tint, no borders around the list; icons at 16 px in `fg-muted`.
- Inputs: slate fill, hairline border, brass focus ring (`0 0 0 2px ink, 0 0 0 4px brass`), placeholder in `fg-faint`.
- Buttons: primary = brass fill with `brass-ink` text; secondary = slate with hairline; ghost = text only; destructive = danger text.
- Chips: hairline outline, brass tint when active.
- Project cards on `/projects`: keep the grid; cards are `slate` tiles with a brass progress ring and hairline separators inside, no drop shadow. Paper is reserved for documents so it keeps its meaning.
- Empty states: one sentence in `fg-muted` plus the action; no dashed boxes.
- Status colours always pair with a word.

## 5. Documents on paper

Applies to item pages (all types), and later the journal and meeting pages.

- The page is the sheet: `on-paper` container, `paper` fill, `radius-lg`, `shadow-paper`, max width 880 px centred with 48 px padding (32 on narrow screens), min-height the viewport minus the header.
- Toolbar above the sheet stays on ink: back link, type, status, home chip, and the icon actions (preview, retry, archive, delete). Save state text lives here.
- Inside the sheet: the title as an editable Newsreader 40 line (placeholder "Untitled"); beneath it a metadata strip in 13 px `paper-muted`: type, home, tags (inline editable chips with an "Add tag" affordance), people chips with "Add person", created date; a hairline; then the body.
- Body: the block editor with a 68ch measure, left margin of 40 px reserved for handles.
- Link and file items: the sheet shows the source (URL or file) as a brass-underlined line under the title, the extracted text in a collapsible paper-2 block, and the notes body below.
- Preview mode renders the same markdown on the same sheet.

## 6. Block editor

Built on the existing TipTap setup; storage stays markdown.

- **Handles.** A `BlockHandles` extension renders, for the block under the pointer or containing the selection, a margin control at the block's top-left: `+` (opens the block picker at that block) and a grip `⋮⋮` (drag to reorder; click opens the block menu). Handles appear on hover and when the block has focus; keyboard: `⌘⇧/` opens the block menu for the current block.
- **Block menu.** Turn into (paragraph, headings 1 to 3, bulleted, numbered, checklist, quote, callout, code), Duplicate, Move up, Move down, Delete. Rendered as a slate `panel` with Manrope 13.
- **Block picker.** The slash menu re-skinned: slate panel, two-column rows (icon + label, hint in `fg-faint`), grouped as Text, Lists, Blocks, Media; typing filters; also opened by the `+` handle.
- **Keyboard feel.** Enter at the end of a heading creates a paragraph; Enter on an empty list item exits the list; Backspace at the start of an empty block deletes it and moves up; Backspace at the start of a heading turns it into a paragraph; Tab and Shift+Tab nest and outdent lists and checklist items; `⌘↑`/`⌘↓` move the current block. These come from StarterKit and TipTap's list keymap plus two small keymap extensions for block moves.
- **Bubble toolbar.** Slate panel with Bold, Italic, Strikethrough, Code, Link, and a "Turn into" dropdown.
- **Callouts.** On paper, tinted with brass-dim (note), success at 14 % (tip), warn at 14 % (warning), with a small icon in the margin and the marker hidden visually (rendered as an icon) while remaining in the markdown.
- **Images.** Full measure width, radius-md, caption from alt text in `paper-muted`.

## 7. Dock

- A slate pill, 56 px tall, radius 999, `shadow-dock`, one hairline highlight on top. Icons 20 px Manrope-weight strokes in `fg-muted`; the active one in brass with a caption in 12 px Manrope beneath the pill (only for the active item; hover shows the others' tooltips as today).
- Groups separated by hairline dividers: Inbox, Projects, Areas, Resources, People | Activity, Library, Archive, Search | Capture | Command.
- Capture is a raised brass circle (40 px) with a `+`, the primary action; Command stays as `⌘`.
- Inbox count as a brass pip with `brass-ink` text; the activity "not recording" dot in danger.
- Below 720 px the dock shows Inbox, Projects, Search, Capture, and a "More" button that opens the remaining entries in a panel.
- Motion: the active caption fades in over 150 ms; press states scale to 0.96 under `motion-safe`.

## 8. Migration

- Tokens and classes are renamed, not layered: `bg`, `surface-*`, `line*`, `accent*` become the tokens above. A codemod pass replaces class names across `src/` in one commit per area; every page is screenshotted before and after.
- `.frost` users become `.panel`. `PageHeader`, `List`, `Row`, `Chip`, `Button`, `IconButton`, `Input`, `Select`, `EmptyState` are restyled once in `ui.tsx`.
- The item page is rebuilt as the sheet (`src/components/document/`); the container editor keeps its layout but adopts the ink chrome; the dock is rebuilt.
- Behaviour freeze: no handler, fetch, autosave, or keyboard logic changes except the block editor additions in section 6.

## 9. Accessibility and quality floor

- Contrast: `fg` on ink 14:1; `paper-fg` on paper 15:1; `brass` on ink 8.7:1; `brass-ink` on brass 9:1; `fg-muted` on ink 6.4:1.
- Focus ring visible on every interactive element; the handles and block menu are keyboard reachable; reduced motion disables press scaling and caption fades.
- Fonts self-hosted through next/font; no external requests at runtime.

## 10. Testing

- Unit: keymap extensions (Enter, Backspace, Tab, block moves) under jsdom against markdown output; block menu "turn into" preserves content; handles appear for the focused block.
- Round-trip corpus unchanged and green.
- Visual: the controller screenshots Inbox, Projects, a project page, a note item, a link item, Search, Activity, and the dock at 1440 and 720 px.

## 11. Implementation order

1. Fonts and tokens; primitives restyled; codemod of class names; dock rebuilt.
2. Document sheet for item pages (title, metadata strip, body on paper), preview parity.
3. Block editor: handles, block menu, picker re-skin, keymaps, bubble toolbar, callout icons.
4. Sweep: lists, cards, activity, search, inbox on the new chrome; README design note.
