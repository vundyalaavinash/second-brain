# Second Brain

A personal capture, search, task, and meeting system that runs locally on a Mac. Stage one covers capture (notes, links, PDFs, images), background processing, and hybrid keyword plus semantic search.

## Install and run

    npm run setup

One command: installs dependencies, builds, downloads the embedding model, installs a launchd agent that starts the app at login and keeps it running on http://localhost:3141, and opens it. After that:

    npm run status      # agent, server, tool and helper state
    npm run update      # after pulling changes: deps, app and helper builds, models, restart
    npm run restart     # restart; add -- --build to rebuild the app, -- --helpers for the Swift helpers
    npm run stop        # stop the agent and the activity helper
    npm run logs        # tail the server log

    scripts/brain.sh helpers   # rebuild and reinstall just the activity helper and the recorder
    scripts/brain.sh open      # open the app in the browser

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
| `⌘.` | Take the action the newest toast offers (Escape dismisses it) |
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

### Recording automatically

Two switches sit in the Meetings header. **Record meetings automatically** is off until you turn it on; with it on, a meeting starts recording itself as it begins — anywhere from two minutes after its start time to a minute before it. **Only with a join link** is on by default and keeps the rule to meetings that have somewhere to join, so a block held in the diary is not recorded.

A meeting you have declined, an all-day block, one already recorded, and one marked "Don't record" on its row are left alone, and nothing auto-starts while another recording is running. A recording started this way stops five minutes after the meeting's scheduled end; **Keep recording** on the dock chip cancels that for a meeting that runs over, and **Stop** ends any recording there and then.

### Meetings from a published calendar

The activity helper reads macOS Calendar, so any account added in System Settings › Internet Accounts with Calendars on shows up on its own. Outlook's own cache cannot be read (the new Outlook keeps an encrypted store and its scripting bridge exposes no events), so for an Outlook account not on the Mac, publish the calendar instead: in Outlook on the web, Settings › Calendar › Shared calendars › Publish a calendar, choose "Can view all details", and paste the ICS link into the **Calendar feed** row under Meetings. Saving the link syncs it straight away and the server re-reads it every five minutes, thirty days back and sixty ahead, recurrences expanded and cancellations dropped. The link is a secret: it is stored as a setting and never leaves the machine. Feed events and helper events live side by side, and each source only ever removes its own — so an account that is both on the Mac and published shows each meeting twice; pick one route for it.

## Planner

`/planner` has three views: **Day**, a timeline of the day's meetings and the plan beside it; **Week**, seven columns of meetings and due tasks, drag a task to another day to change its due date, or pick a day from its "Plan for" menu to add it to that day's plan; and **Meetings**, every meeting in the next 60 days, searchable by title, organizer, or attendee. Plan a task for today from its row menu anywhere in the app; a plan left unfinished offers a one-click carry-over to move it to today.

**Planning the day.** The Day view is the timeline beside the plan. Tasks reach the plan through the field under it: type to search every open task, or type something new and Enter creates it (with `~25m` and due-date words understood, as in the prompt bar) and plans it in one go. Before you type it suggests what is overdue, due today and left from yesterday, and the Due, Inbox, Projects and Areas chips browse one home at a time. Enter plans the highlighted row and keeps the field ready for the next; `⌘Enter` plans and closes; Escape or a click away closes it; `⌘/` puts the keyboard there from anywhere on the page. Estimates come either from the prompt bar, where `~25m` or `~1h30m` on the end of a new task sets one, or from the `est` chip on any task row, which offers a few presets and takes 5 to 480 minutes. A session length can ride along on the same word: `~2h/45m` sets a two-hour estimate split into 45-minute sessions, in both the prompt bar and the plan's own field. The header's capacity line reads how many tasks are planned, their minutes against the time the calendar leaves free, how many carry no estimate, and how many meetings there are; the chip beside it sets the working hours the free time is measured from. On an empty plan for today, a morning ritual walks through carrying over yesterday's unfinished tasks, planning what is overdue or due, and picking something from a project; steps with nothing to offer are left out, so it runs one to three steps long. Each step can be skipped, and once it is walked through it stays away for the rest of the day. Press `p` on any task row to put that task on a plan — today's plan in most of the app, that column's day in the Week view — and press it again on a planned row to take it off. The command palette lists matching open tasks under **Plan** once two characters are typed, and choosing one puts it on today's plan.

**Time-blocking.** A task holds any number of **sessions** on the timeline. Drag a plan row onto the column to place one where it lands: it is as long as the task's session length, which is the whole estimate up to an hour and 45 minutes beyond that, and never shorter than 15 minutes, and **Split into** on the row menu sets it to 25, 45, 60 or 90 minutes, or back to **One session**. A task dropped with no estimate is asked how long the session is, and the answer becomes both. Drag a session to move it, drag its bottom edge to resize it, or take the keyboard to it — the arrows move it by 15 minutes, Shift and the arrows by 5, Alt and the arrows resize it, and Backspace takes it off the timeline without taking the task off the plan. A task with more than one session on the day marks each one · 2 of 3.

**Place in free slots** on a row menu, or `f` on the focused row, clears the task's sessions on the day and lays fresh ones into the gaps the calendar leaves, earliest first and never straddling a meeting or another session. On today it starts no earlier than now; on any other day it starts at the top of the working hours. Two sessions of the same task laid in one gap keep ten minutes apart — the break is not held for the task, so anything else placed after it may take that time. **Fill the day** in the plan's own menu does the same for every plan task that has no session yet, in plan order. What the day had no room for is **unplaced**: the toast after a place says "Placed 3 sessions, 1h 20m unplaced" and offers **Place tomorrow** (named for the day itself, **Place on Fri 25**, when the day on screen is not today), which from a single row plans the task for the next day and places it there; after **Fill the day** it plans nothing new — it places what the next day already carries. A toast with an offer stays for twenty seconds, `⌘.` takes it from anywhere, and Escape puts it away; the header's capacity line carries the unplaced figure after the blocked one.

**Block now** on a plan row menu, or `n` on the focused row, starts one session at the next five minutes, and **Take off the timeline** clears the day's sessions. A row with a session shows when the first one starts, with a "+2" counting the others the day holds, and pressing it scrolls the timeline to that session and hands it the keyboard. The plan's menu sorts the day's rows by their first session with **Sort by time**, and rows with no session keep their order at the end. The header's capacity line says how much of the plan is blocked, the bar under the plan shows it as a brighter segment, and a day with blocked time carries a violet dot in the Week view.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-12-second-brain-design.md`
- Plans: `docs/superpowers/plans/`
