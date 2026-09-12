# Second Brain: Stage One Design

Date: 2026-09-12
Status: approved in discussion, awaiting written review

## 1. Purpose

A personal second brain for one user, running as an always-on local web app on a Mac. Stage one covers:

- Capture of notes, web links, files (PDF and images), and meetings.
- Hybrid keyword and semantic search over everything captured.
- Projects, tasks, recurring tasks, and a daily plan.
- A daily journal and a guided weekly review.
- Meeting recording with live transcription, a final high-quality transcript, an AI summary, and proposed action items.
- A Claude-powered assistant that answers from the knowledge base and can create tasks.

Explicitly out of scope for stage one: imports from other tools, mobile or remote access, multiple users, sync between devices, speaker diarization, and a packaged desktop app.

## 2. Architecture

One Node process running Next.js (App Router, TypeScript, strict mode). The process serves the UI, the HTTP API, a server-sent events endpoint, and an in-process background job worker.

```
Browser (localhost:3141)
   |  HTTP + SSE
Next.js process
   |-- UI (React server and client components, Tailwind)
   |-- API routes (route handlers under /api)
   |-- Job worker (in-process loop, one job at a time)
   |-- Providers: chat (Claude), embed (transformers.js), transcribe (whisper.cpp)
   |-- Recorder controller (spawns the Swift helper)
   |
SQLite file  +  files/ folder  +  models/ folder
   (FTS5 + sqlite-vec)
```

Data directory: `~/Library/Application Support/second-brain/` containing `brain.db`, `files/`, `models/`, `logs/`, and `backups/`.

### Stack

| Concern | Choice |
|---|---|
| Framework | Next.js, App Router, TypeScript |
| Database | SQLite via better-sqlite3, schema and migrations with Drizzle |
| Keyword search | SQLite FTS5 |
| Vector search | sqlite-vec extension |
| Embeddings | transformers.js with `bge-small-en-v1.5` (ONNX), in-process |
| Chat | Anthropic TypeScript SDK, model `claude-opus-5`, adaptive thinking, streaming, tool runner |
| Transcription | whisper.cpp binary. `large-v3-turbo` for final transcripts, `base.en` for live |
| PDF text | pdf-parse |
| Image text | Tesseract via tesseract.js |
| Link extraction | Mozilla Readability on fetched HTML |
| Audio capture | Swift command-line helper using Core Audio process taps plus microphone |
| Styling | Tailwind, no component library |
| Tests | Vitest |
| Process management | launchd user agent |

### Module layout

```
src/
  app/                 pages and API route handlers
  db/                  schema.ts, migrations/, client.ts
  domain/
    items/             create, update, chunking, status transitions
    tasks/             tasks, projects, recurrence, daily plan
    journal/           daily entries and template
    review/            weekly review assembly and steps
    search/            fts query, vector query, fusion
    meetings/          recorder controller, live transcript session, summary
    assistant/         system prompt, tools, conversation persistence
  providers/
    chat/              interface + claude adapter
    embed/             interface + transformers adapter
    transcribe/        interface + whisper adapter (file and stream)
  jobs/                queue, worker loop, handlers per job type
  lib/                 config, logging, paths, sse
helper/recorder/       Swift package for the audio capture helper
scripts/               install, model download, launchd plist, backup
```

Each domain module exposes plain functions that take a database handle. Route handlers and jobs are thin and call domain functions. Providers are only reached through their interfaces.

## 3. Data model

All tables have integer primary keys, `created_at`, and `updated_at` as ISO strings.

### items

The single table for everything captured.

| Column | Notes |
|---|---|
| type | `note`, `link`, `file`, `meeting`, `journal`, `review` |
| title | text, required, may be auto-generated |
| body | markdown, the user-editable content |
| status | `pending`, `processing`, `ready`, `failed` |
| error | last job error message, null when fine |
| source_url | links only |
| file_path | files and meetings, relative to `files/` |
| mime_type | files only |
| extracted_text | text pulled from a link, PDF, image, or transcript. Not user-edited |
| meta | JSON for type-specific data (see below) |
| journal_date | `YYYY-MM-DD`, journals only, unique |
| review_week | `YYYY-Www`, reviews only, unique |

Type-specific `meta`:

- `meeting`: `{ duration_seconds, live_transcript, final_transcript_ready, summary, decisions[], proposed_actions[] }`. Each proposed action is `{ id, title, notes, accepted: boolean, task_id }`.
- `link`: `{ site_name, fetched_at, byline }`.
- `file`: `{ page_count }` for PDFs.

### tags and item_tags

Free-form tags. `item_tags` joins items to tags.

### chunks

| Column | Notes |
|---|---|
| item_id | parent item |
| ordinal | order within the item |
| text | roughly 500 tokens with 50 tokens overlap |
| embedding | stored in a sqlite-vec virtual table keyed by chunk id |

A companion FTS5 virtual table `chunks_fts(text, content=chunks)` is kept in sync with triggers.

Chunks are built from `title + body + extracted_text`. Re-chunking happens whenever body or extracted_text changes. Old chunks and vectors are deleted first.

### projects

| Column | Notes |
|---|---|
| name | required |
| description | markdown |
| status | `active`, `done`, `archived` |

### tasks

| Column | Notes |
|---|---|
| title | required |
| notes | markdown |
| status | `open`, `done`, `dropped` |
| priority | `low`, `normal`, `high` |
| due_date | `YYYY-MM-DD` or null |
| project_id | nullable. Null means Inbox |
| source_item_id | nullable. The item the task came from |
| recurrence | rule string or null |
| completed_at | timestamp |
| sort_order | integer for manual ordering within a project |

Recurrence grammar, parsed by a small hand-written parser:

- `every day`, `every weekday`
- `every N days|weeks|months`
- `every monday` and other weekday names, with optional list: `every mon,wed,fri`
- `every month on 15`

Completing a recurring task marks it done and creates the next instance with the next due date computed from the rule and the original due date. Only the next instance exists at any time.

### daily_plan_entries

| Column | Notes |
|---|---|
| date | `YYYY-MM-DD` |
| task_id | |
| sort_order | |

Unique on (date, task_id). A task can appear in several days' plans if it was carried over.

### jobs

| Column | Notes |
|---|---|
| type | `fetch_link`, `extract_pdf`, `ocr_image`, `transcribe_final`, `summarize_meeting`, `embed`, `weekly_reflect`, `backup` |
| payload | JSON |
| status | `queued`, `running`, `done`, `failed` |
| attempts | integer |
| error | last error |
| run_after | timestamp, for delays and retries |
| item_id | nullable, for status display |

### conversations and messages

`conversations` has a title and timestamps. `messages` has `conversation_id`, `role`, and `content` as JSON holding the full Anthropic content block array, so tool use, tool results, and thinking blocks are preserved for replay.

### settings

Key-value table. Holds the Anthropic API key when not provided by environment, the journal template, and the recorder preferences.

## 4. Capture pipeline

Capture never blocks on processing. The flow for every type:

1. Insert the item with `status = pending`.
2. Enqueue the type-specific job.
3. Return the item id to the UI immediately.

Type-specific first jobs:

| Type | Job | Output |
|---|---|---|
| note | `embed` | chunks and vectors |
| link | `fetch_link` | fetches HTML with a browser user agent, runs Readability, stores title and `extracted_text`, then enqueues `embed` |
| file (PDF) | `extract_pdf` | `extracted_text` and page count, then `embed` |
| file (image) | `ocr_image` | `extracted_text`, then `embed` |
| file (audio) | `transcribe_final` | creates a meeting item from the audio (see section 8) |
| meeting | handled by the recorder flow in section 8 |
| journal, review | `embed` on save |

Notes and journals are also re-embedded on every edit, debounced by five seconds.

Uploaded files are copied into `files/YYYY/MM/<uuid>-<original name>`. The database stores the relative path.

### Job worker

A loop in the Next.js process, started once on server boot via the instrumentation hook. It polls the `jobs` table every second, claims the oldest queued job whose `run_after` has passed, marks it running, executes the handler, and marks it done or failed. Failures retry up to three times with exponential backoff (10 s, 60 s, 300 s), then stay failed with the error copied onto the item. The UI shows a retry button that resets the job to queued.

While a live meeting recording is active, the worker only runs jobs of type `transcribe_final` and `summarize_meeting`. Everything else waits.

The worker runs one job at a time. This is deliberate: the machine is also running the user's meeting, browser, and other work.

## 5. Search

Hybrid search combining two result lists:

1. Keyword: an FTS5 `MATCH` query on `chunks_fts` with BM25 ranking, top 50.
2. Semantic: embed the query with the same model, sqlite-vec nearest neighbours by cosine distance, top 50.

Fusion: reciprocal rank fusion with k = 60. Results are grouped by item, keeping the best chunk per item as the snippet, and returned as a ranked item list.

Filters applied before fusion: item type, tag, and created date range. Filters are SQL `WHERE` clauses joined on `items`.

The embedding model loads once at startup in a worker thread so the first query does not stall the UI. Embedding a chunk takes tens of milliseconds on Apple Silicon; a 50-page PDF embeds in well under a minute.

Search is exposed as `search(query, filters, limit)` in `domain/search` and used by both the Search page and the assistant's search tool.

## 6. Tasks, projects, and daily plan

Views:

- **Today**: the daily plan for today in manual order, then a section of tasks due today or overdue that are not on the plan, then quick links to today's journal and, from Friday onward, the weekly review if it is not done.
- **Upcoming**: tasks grouped by due date for the next 14 days.
- **Inbox**: open tasks with no project.
- **Project page**: the project's open tasks in manual order, done tasks collapsed.

Interactions:

- Add a task inline from any view with a title. Optional fields expand on demand.
- Drag to reorder within the daily plan and within a project.
- "Plan for today" on any task adds it to today's daily plan entries.
- Unfinished plan entries roll forward: opening Today shows yesterday's unfinished plan tasks with a one-click "carry over".
- Completing a recurring task spawns the next instance as defined in section 3.

Tasks created from a meeting's proposed actions set `source_item_id` to the meeting, and the task shows a link back.

## 7. Daily journal

One `journal` item per date. Opening today's journal from Today creates it if missing, seeded from the template in settings. The default template:

```
## Focus
-

## Notes

## Learned

## Grateful
```

The journal page has three regions: the markdown editor, a read-only panel of today's plan with completion state, and a list of items captured that day. Past days are reachable through a date picker and previous/next arrows.

Journals are chunked and embedded like any item, so the assistant and search can reach them.

## 8. Meetings

### Recorder helper

A Swift package in `helper/recorder/` that builds a command-line binary `sb-recorder`. It:

- Captures system audio with a Core Audio process tap on the default output device and mixes in the default microphone.
- Writes a 16 kHz mono WAV file continuously to a path given on the command line.
- Streams the same 16 kHz mono PCM as raw little-endian 16-bit samples to stdout.
- Stops cleanly on SIGINT, flushing the WAV header.
- Prints one JSON status line to stderr on start (`{"state":"recording"}`) and on any error.

The first run prompts macOS for audio capture permission. The install script runs the helper once for two seconds so the prompt happens at install time rather than at the start of a real meeting.

### Recorder controller

`domain/meetings/recorder.ts` owns a single recording session at a time. Its interface:

```
start(): { meetingId }
stop(): void
status(): { state: "idle" | "recording" | "error", meetingId?, startedAt?, error? }
```

`start()` creates a `meeting` item with `status = processing`, spawns `sb-recorder` with a target WAV path under `files/`, and hands the stdout stream to a live transcript session. `stop()` sends SIGINT, waits for exit, records the duration, and enqueues `transcribe_final`.

If the helper exits unexpectedly, the controller marks the session as error, keeps whatever WAV was written, and enqueues `transcribe_final` on it so nothing is lost.

### Live transcription

`domain/meetings/live.ts` buffers PCM from the helper. Every 5 seconds it takes the last 30 seconds of audio, writes it to a temp WAV, runs whisper.cpp with `base.en`, and aligns the result against the previous window by trimming to text after the last committed timestamp. Committed segments are appended to `meta.live_transcript` and pushed to subscribers over server-sent events at `/api/meetings/[id]/live`.

The meeting page during recording shows the growing live transcript on the left and a notes editor on the right that writes to the item's `body`.

### Final transcript and summary

`transcribe_final` runs whisper.cpp on the full WAV with `large-v3-turbo`, stores the result in `extracted_text`, sets `meta.final_transcript_ready = true`, then enqueues `summarize_meeting` and `embed`.

`summarize_meeting` makes one Claude call with structured output returning:

```
{ summary: string, decisions: string[], proposed_actions: { title: string, notes: string }[] }
```

The input is the final transcript and the user's notes from `body`. Results land in `meta`. Proposed actions appear on the meeting page as checkboxes with an editable title. Accepting one creates a task with `source_item_id` set and stores the `task_id` back on the proposed action. Nothing becomes a task without acceptance.

### Dropped-in recordings

Uploading an audio file (m4a, mp3, wav, webm) creates a `meeting` item and enqueues `transcribe_final` directly. Files that are not 16 kHz mono WAV are converted with ffmpeg first, and ffmpeg is a documented install dependency.

## 9. Assistant

`providers/chat` defines:

```
interface ChatProvider {
  stream(request: ChatRequest): AsyncIterable<ChatEvent>
  structured<T>(request: StructuredRequest<T>): Promise<T>
}
```

The Claude adapter uses the Anthropic TypeScript SDK with model `claude-opus-5`, `thinking: { type: "adaptive" }`, streaming, and `max_tokens` of 16000 for chat. Tool calls are driven by the SDK's beta tool runner with tools defined through `betaZodTool`. The `structured` method uses `output_config.format` with a Zod schema.

Tools available in chat:

| Tool | Behaviour |
|---|---|
| `search_knowledge` | calls `domain/search` with query and optional type filter, returns up to 10 items with snippets and ids |
| `read_item` | returns an item's title, body, and extracted text by id |
| `create_task` | creates a task with title, notes, due date, project name, and priority. Project name is matched case-insensitively and created if missing |
| `list_tasks` | returns open tasks filtered by project, due range, or plan date |

The system prompt states the assistant's job, the current date, and asks it to cite item ids in the form `[item:123]` when it uses retrieved content. The UI turns those into links. The system prompt is static apart from the date, which is placed in the first user message rather than the system prompt so the prompt prefix stays cacheable.

Conversations persist every content block as returned by the API, including thinking blocks, so multi-turn replay is exact.

The weekly review's Reflect step and the meeting summary both go through `structured`.

API key resolution: `ANTHROPIC_API_KEY` environment variable first, then the `settings` table. If neither is set, the Chat page and the Reflect step show a message pointing at Settings, and nothing else is affected.

## 10. Weekly review

A `review` item per ISO week, created when the user opens the review for a week. The page is a four-step flow with a step indicator. Progress is saved in `meta.step`.

1. **Look back**: computed counts for the week (tasks completed, items captured by type, meetings), a list of the week's journal entries, and the week's meeting summaries.
2. **Clean up**: open tasks that are overdue or were on a daily plan this week and not completed. Each row has actions: reschedule (date picker), move to project, mark done, drop.
3. **Reflect**: a `weekly_reflect` job calls `structured` with the week's journal bodies, meeting summaries, and completed task titles, returning `{ highlights: string[], themes: string[], suggested_focus: string[] }`. The result is rendered into the review item's `body` as markdown that the user edits freely. Re-running is allowed and overwrites only the generated section.
4. **Look ahead**: a list of open tasks with a day-of-next-week picker that writes `daily_plan_entries`.

Marking the review done sets `meta.done = true` and clears the Today reminder.

## 11. UI

Left sidebar with Today, Capture, Library, Search, Chat, Journal, Review, and a Projects list. Content area to the right. Layout is desktop-first and single-column below 900 px.

- **Capture**: one text area that accepts typed markdown, a pasted URL (detected by pattern and captured as a link), dropped or pasted files, and a Record button. A global keyboard shortcut opens Capture as an overlay from any page.
- **Library**: items list with type, tag, and date filters, status badges for pending and failed, and retry on failed.
- **Item page**: title, tags, markdown editor for `body`, and a collapsible panel with `extracted_text` for links and files. Meeting pages add audio playback, the transcript, the summary, and proposed actions.
- **Search**: query box with filters, results with highlighted snippets.
- **Chat**: conversation list, streaming responses, citations as links, and a visible note when the assistant created a task.
- **Journal, Review, Today, Projects**: as described in their sections.

Markdown editing uses a plain textarea with a preview toggle in stage one. A richer editor is a later concern.

## 12. Running it

`scripts/install.sh`:

1. Checks for Node 22+, Xcode command line tools, and ffmpeg.
2. Runs `npm ci` and `npm run build`.
3. Builds `sb-recorder` with `swift build -c release` and runs it for two seconds to trigger the permission prompt.
4. Downloads whisper.cpp, builds it with Metal, and fetches the `large-v3-turbo` and `base.en` models into `models/`.
5. Downloads the embedding model into `models/`.
6. Writes `~/Library/LaunchAgents/com.avinash.second-brain.plist` to run `npm start` on port 3141 at login, with stdout and stderr redirected to `logs/`.
7. Loads the agent and opens the browser.

`scripts/backup.sh` copies `brain.db` using SQLite's online backup API to `backups/brain-YYYY-MM-DD.db` and keeps the newest seven. A `backup` job runs it nightly from the worker.

Configuration lives in `.env.local` for development and in the launchd plist environment for the installed app. The only required secret is the Anthropic API key, and it can instead be set from the Settings page.

## 13. Error handling

- Captured content is written before any processing starts, so a processing failure never loses input.
- Every job failure is recorded on both the job and the item, with a retry button in the UI.
- The recorder helper crashing mid-meeting keeps the partial WAV and still produces a final transcript.
- Claude errors are shown in the chat as a system message with the error type. Rate limits retry twice through the SDK's built-in retries before surfacing.
- A missing embedding model disables semantic search and logs a warning. Keyword search still works.
- A missing whisper binary or model marks transcribe jobs failed with an install hint.
- All server errors are logged to `logs/app.log` with a request id.

## 14. Testing

Vitest with a fresh SQLite file per test file.

Unit tests:

- Chunking: boundaries, overlap, and empty inputs.
- Recurrence parser and next-date computation, including month ends and weekday lists.
- Reciprocal rank fusion ordering and grouping by item.
- Job worker: claim, retry backoff, max attempts, pause during recording.
- Daily plan carry-over logic.
- Live transcript window alignment, using fixture text.
- Proposed action acceptance creating a task with the right links.

Provider tests:

- The Claude adapter is tested against recorded fixture responses, never live.
- The whisper adapter is tested with a bundled 5-second WAV and the `base.en` model, skipped when the model is absent.
- The embed adapter is tested for vector dimension and determinism.

Integration tests through route handlers for capture of each type with jobs run synchronously.

Manual checklist for the recorder helper: permission prompt appears, system audio and mic both present in the WAV, clean stop, and crash recovery.

## 15. Implementation order

Each slice ends with a usable app.

1. Project skeleton, database, items, notes, Library, and keyword search.
2. Links, files, job worker, embeddings, and hybrid search.
3. Projects, tasks, recurrence, daily plan, Today, Upcoming, Inbox.
4. Daily journal.
5. Recorder helper, live transcription, final transcript, meeting page.
6. Assistant chat with tools, meeting summary and proposed actions.
7. Weekly review.
8. Install script, launchd, backups.
