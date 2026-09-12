# Second Brain

A personal capture, search, task, and meeting system that runs locally on a Mac. Stage one covers capture (notes, links, PDFs, images), background processing, and hybrid keyword plus semantic search.

## Run in development

    npm install
    npm run dev

Open http://localhost:3141. Data lives in `~/Library/Application Support/second-brain/` (override with `SB_DATA_DIR`). The first capture downloads the embedding model (about 35 MB) into the `models/` folder there.

## Run tests

    npm test

The transformers embedding test downloads the model into `~/.cache/second-brain-test-models` on first run.

## Environment

| Variable | Purpose |
|---|---|
| `SB_DATA_DIR` | Data directory. Defaults to Application Support. |
| `SB_EMBED` | Set to `off` to disable semantic search and run keyword-only. |

## Keyboard

| Keys | Action |
|---|---|
| `⌘K` | Command palette |
| `g c`, `g l`, `g s` | Go to Capture, Library, Search |
| `/` | Focus search |
| `⌘↵` | Capture |
| `⌘S` | Save item |

## Design docs

- Spec: `docs/superpowers/specs/2026-09-12-second-brain-design.md`
- Plans: `docs/superpowers/plans/`
