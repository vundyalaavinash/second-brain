# Second Brain

A personal capture, search, task, and meeting system that runs locally on a Mac. Stage one covers capture (notes, links, PDFs, images), background processing, and hybrid keyword plus semantic search.

## Install and run

    npm run setup

One command: installs dependencies, builds, downloads the embedding model, installs a launchd agent that starts the app at login and keeps it running on http://localhost:3141, and opens it. After that:

    npm run status      # agent and server state
    npm run restart     # restart; add -- --build after pulling changes
    npm run stop        # stop the agent
    npm run logs        # tail the server log

The script behind these is `scripts/brain.sh`.

## Run in development

    npm install
    npm run dev

Open http://localhost:3141. Stop the launch agent first (`npm run stop`) if it is running, since both use the same port. Data lives in `~/Library/Application Support/second-brain/` (override with `SB_DATA_DIR`). The first capture downloads the embedding model (about 35 MB) into the `models/` folder there.

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
| `g i` `g p` `g a` `g r` `g e` `g l` `g x` `g s` `g c` | Inbox, Projects, Areas, Resources, People, Library, Archive, Search, Capture |
| `/` | Focus search |
| `⌘↵` | Capture |
| `⌘S` | Save item, container, or person |
| In the Inbox: `p` `a` `r` `e` `x` `j` `k` `l` | File to project / area / resource, archive, delete, next, previous, list view |

## How things are organised

PARA. Every capture lands in the Inbox. Processing the Inbox files each item into exactly one home: a **Project** (an outcome with a deadline), an **Area** (a responsibility with a standard), or a **Resource** (a topic, grouped by category). Anything inactive is **Archived**, and completing a project asks where its items should go. People are a light CRM: mention `@slug` in a note to link it to a person.

### Design

The interface is dark, dense, and quiet: one accent colour for what is live or selected, Lucide icons, Geist type, and a floating dock. Motion is limited to state changes and respects reduced-motion settings.

## Activity tracking

A Swift helper (`helper/activity`, installed by `scripts/brain.sh setup` as the launch agent `com.second-brain.activity`) samples the frontmost app every 5 seconds and posts heartbeats to the local server. It records: the frontmost app and its window title, the browser URL for Chrome, Arc, Brave, Edge, and Safari, away time once you have been idle for 3 minutes, and calendar events for today and tomorrow.

Three macOS permissions make this work, and the system asks for each on first run: **Accessibility** (to read the focused window title), **Automation** per browser (to read the active tab's URL), and **Calendars** (to read upcoming events). Nothing is recorded before a permission is granted for that data.

A set of exclusions ships pre-seeded (password managers, banking apps, and similar) so their app or domain never gets recorded; add more from the Rules drawer. Recording can be paused entirely from the same drawer — the helper keeps pinging the server so "last seen" stays fresh, but nothing is stored while paused. Activity data is kept for 90 days by default and pruned nightly.

To uninstall the helper: `scripts/brain.sh stop`, then `launchctl bootout gui/$(id -u)/com.second-brain.activity`, then delete `~/Library/LaunchAgents/com.second-brain.activity.plist` and `DATA_DIR/bin/sb-activity`.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-12-second-brain-design.md`
- Plans: `docs/superpowers/plans/`
