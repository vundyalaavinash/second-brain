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

### Tasks

Tasks belong to a project or an area. Add one from the project or area page: Enter adds it, end with a day like `fri` or a date to set a due date, and start with `!` for high priority. Check tasks off, drag to reorder, and each project card shows its progress and the next open task. The old next-steps checklist was converted into tasks the first time the app started after this update.

### Links and notes

Projects, areas, and resources each have a Links section and a Notes section. Paste a URL to capture a link without leaving the page; pasting one already saved points you to the existing item instead of duplicating it. Star a link to pin it, up to three of which show as domain chips on that project's card. "New note" opens a fresh untitled note for the container. The container's own description lives behind an "About this project/area/resource" disclosure above these sections. Archived projects, areas, and resources show their links and notes too, read-only.

### Design

The interface is a carbon workspace: a floating dock, a breadcrumb bar, a context rail beside documents, and one prompt bar that captures, adds tasks, and searches from any page. One violet accent, serif titles, small mono labels. Motion is limited to state changes and respects reduced-motion settings.

### Writing

Notes use a block editor. Type `/` for blocks, markdown shortcuts work as you type, and you can paste or drop images into an item's note — containers and people have nowhere to store an image, so use a note there instead. Callouts are `> [!note]`, `> [!tip]`, and `> [!warning]` blockquotes. Footnotes are not supported; the editor escapes their brackets. Everything is stored as markdown, so search and backups see plain text.

## Activity tracking

A Swift helper (`helper/activity`, installed by `scripts/brain.sh setup` as the launch agent `com.second-brain.activity`) samples the frontmost app every 5 seconds and posts heartbeats to the local server. It records: the frontmost app and its window title, the browser URL for Chrome, Arc, Brave, Edge, and Safari, away time once you have been idle for 3 minutes, and calendar events for today and tomorrow.

Three macOS permissions make this work, and the system asks for each on first run: **Accessibility** (to read the focused window title), **Automation** per browser (to read the active tab's URL), and **Calendars** (to read upcoming events). Nothing is recorded before a permission is granted for that data.

**Calendar**: add your Microsoft 365 account in System Settings › Internet Accounts with Calendars on; the helper reads it through EventKit.

A set of exclusions ships pre-seeded (password managers, banking apps, and similar) so their app or domain never gets recorded; add more from the Rules drawer. Pause is a chip in the page header — the helper keeps pinging the server so "last seen" stays fresh, but nothing is stored while paused. Activity data is kept for 90 days by default and pruned nightly.

To uninstall the helper: `scripts/brain.sh stop`, then `launchctl bootout gui/$(id -u)/com.second-brain.activity`, then delete `~/Library/LaunchAgents/com.second-brain.activity.plist` and `DATA_DIR/bin/sb-activity`.

## Meetings and recording

Recording needs two Homebrew tools and a Swift helper:

    brew install whisper-cpp ffmpeg

`scripts/brain.sh setup` builds the recorder (`helper/recorder`, installed as `DATA_DIR/bin/sb-recorder`), downloads the whisper models into `DATA_DIR/models/whisper/` (`ggml-base.en.bin` for the live transcript, `ggml-medium.en.bin` for the final pass, linked instead of downloaded again when `whisper-cpp` already has it), and runs the recorder once so macOS raises its prompts. `npm run status` reports `recorder:`, `whisper:`, and `ffmpeg:`.

Two permissions matter, both asked for on that first run: **Microphone**, and on macOS 14.2 and newer **System Audio Recording** — the recorder taps the default output device so the other side of a call is captured too. Refuse the second and recording still works, microphone only. Answer them in System Settings › Privacy & Security, then re-check with:

    "$HOME/Library/Application Support/second-brain/bin/sb-recorder" --probe

Recordings are written as 16 kHz mono WAV under `DATA_DIR/files/meetings/`, alongside their transcripts; nothing is uploaded, and both whisper models run locally.

## Planner

`/planner` has three views: **Day**, a timeline of the day's meetings beside the plan for it, with what is due below; **Week**, seven columns of meetings and due tasks, drag a task to another day to change its due date, or pick a day from its "Plan for" menu to add it to that day's plan; and **Meetings**, every meeting in the next 60 days, searchable by title, organizer, or attendee. Plan a task for today from its row menu anywhere in the app; a plan left unfinished offers a one-click carry-over to move it to today.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-12-second-brain-design.md`
- Plans: `docs/superpowers/plans/`
