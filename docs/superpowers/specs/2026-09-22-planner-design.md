# Planner: day plan, meetings, recordings, transcripts

Date: 2026-09-22. Builds on the Carbon shell and the floating dock. Replaces the thin Today page with a Planner section and implements the master spec's sections 6 (daily plan) and 8 (meetings) on today's stack: EventKit through the activity helper for the calendar, a Swift recorder helper for audio, whisper.cpp for speech to text, and Claude for summaries when a key is present.

## 1. Purpose

One place to run the day: what is planned, what is due, which meetings are coming, and, for each meeting, the notes, the transcript, and the follow-ups. Recording starts by itself when a meeting begins, so the transcript is there afterwards without anyone remembering to press a button.

## 2. Where it lives

- Dock: the first item becomes **Planner** (`/planner`, `g d`, Phosphor `CalendarCheck`); the Today route redirects to `/planner`. While a recording runs, a recording chip is attached to the dock's left edge: a red dot, the elapsed time in mono, the meeting title, and a Stop button. Clicking the title opens the meeting page.
- Planner page: a `PageHeader` with the date numeral header from Today, then three views chosen by a segmented control that also drives the URL (`/planner`, `/planner/week`, `/planner/meetings`), so each view is linkable and the breadcrumb reads "Planner / Week".

## 3. Views

### Day (`/planner`)

Two columns above 1100 px, stacked below.

- **Timeline** (left, 60 %): the day from 07:00 to 21:00 (extends to the earliest and latest meeting), hour rules in `hairline`, the current time as a violet line, meetings as blocks (`pane`, title, start and end in mono, attendee count, a Join button when a call link exists, a Record or Recording state, badges for notes, transcript, summary). All-day events sit in a strip above the timeline. Clicking a block opens the meeting page.
- **Plan** (right): the daily plan in manual order (`daily_plan_entries` for the date), drag to reorder, each row a `TaskRow`; "Plan for today" is a new action in every task row's menu app-wide; a **Carry over** banner lists yesterday's unfinished plan entries with one button that moves them all to today. Below it **Due**: open tasks due on or before the date that are not on the plan (overdue in danger, today in warn). Adding a task from the prompt bar while on the Planner both creates it and plans it for the selected date.
- Header actions: previous day, next day, Today; the date numeral updates. The header's mono line reads "3 planned, 2 due, 4 meetings".

### Week (`/planner/week`)

Seven columns Monday to Sunday (the current week; previous and next arrows), each with the day number (today highlighted in violet), its meetings as compact rows (time, title) and its due tasks as `TaskRow`s. Dragging a task between columns changes its due date; dropping onto a column's plan area plans it for that day. A "Plan for" popover on any task row picks a weekday.

### Meetings (`/planner/meetings`)

Grouped by day: today, then upcoming (60 days), then a collapsed "Past 30 days". Each row: time range in mono, title, organizer, attendee count, Join, a Record button (or the Recording chip state), and badges: Notes (when the meeting item has a body), Transcript (when `meta.transcript` exists), Summary. A search box filters by title, organizer, and attendee names. Rows open the meeting page; meetings without an item yet create one on open (`captureMeeting`). A **Record now** button starts an ad-hoc recording ("Meeting at 14:05") when there is no calendar event.

## 4. Calendar depth

The helper's `CalendarReader` window becomes 30 days back and 60 days forward, refreshed every 5 minutes and on `EKEventStoreChanged`. Each event adds: `organizer` (name), `attendeeNames` (up to 10), `location`, `joinUrl` (the first Teams, Zoom, Meet, Webex, or generic `https://` URL found in the URL field, location, or notes), `notes` (first 4 000 characters), `allDay`, `status` (`accepted`, `tentative`, `declined`, `none`), `calendarTitle`. `POST /api/activity/calendar` accepts them; migration 0007 adds the columns to `calendar_events` (nullable, defaults empty). The helper's status reports `calendarsSeen` (number of calendars EventKit exposes).

Setup card (on the Planner and the Meetings view) when `calendarsSeen` is 0 or the helper has no calendar permission: "No calendars are visible. Add your Microsoft 365 account in System Settings › Internet Accounts with Calendars turned on, then reopen this page." with a button that opens the Internet Accounts pane (`x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension` via the helper's `open` command, exposed as `POST /api/activity/open-settings`). The card disappears once events arrive.

## 5. Recording

### Recorder helper

`helper/recorder/`, a Swift package producing `sb-recorder`, installed to `$DATA_DIR/bin/sb-recorder` by `scripts/brain.sh setup` (and `helper` subcommands mirror the activity helper's: build, permissions). It:

- captures system audio with a Core Audio process tap on the default output device (macOS 14.2 or later) mixed with the default microphone;
- writes a 16 kHz mono 16-bit WAV to the path given as the first argument, flushing the header on SIGINT;
- streams the same PCM to stdout as raw little-endian 16-bit samples;
- prints one JSON line to stderr on start (`{"state":"recording"}`), on device changes, and on error;
- `sb-recorder --probe` records two seconds to a temp file and exits, used at setup to trigger the permission prompts.

### Controller

`src/domain/meetings/recorder.ts` owns one session at a time:

```
start(target: { calendarEventId } | { itemId } | { adhoc: true }): { itemId; startedAt }
stop(): Promise<void>
status(): { state: "idle" | "recording" | "stopping" | "error"; itemId?; title?; startedAt?; error? }
```

`start` resolves or creates the meeting item (`captureMeeting` for calendar events; an item with `type = meeting`, title "Meeting at HH:MM" for ad-hoc), sets `meta.recording = { startedAt, wavPath, state: "recording" }`, spawns `sb-recorder <wavPath>` where `wavPath = files/meetings/<itemId>-<timestamp>.wav`, and hands stdout to the live transcriber. `stop` sends SIGINT, waits for exit (10 s cap, then SIGTERM), sets `meta.recording.state = "done"`, and enqueues `transcribe_final`. If the helper exits on its own, the controller records `error`, keeps the WAV, and still enqueues `transcribe_final`. A second `start` while recording returns 409.

API: `GET /api/meetings/recorder` (status), `POST /api/meetings/recorder/start`, `POST /api/meetings/recorder/stop`. The dock polls status every 5 s while a recording is in progress and on `sb:recording-changed`.

### Auto-start

Settings: `meetings.autoRecord` (default on) and `meetings.autoRecordNeedsCallLink` (default on). A scheduler tick every 30 s in `src/server/boot.ts` (same process as the job worker) looks for calendar events with `startsAt` within the last 2 minutes and the next 1 minute, `status` not `declined`, not all-day, a `joinUrl` when the second setting is on, and no `meta.recording` yet on their item; it starts the recorder for the first match if idle and posts a toast through `sb:recording-changed` ("Recording Product sync"). At `endsAt + 5 min` a running auto-started session stops itself unless the user pressed **Keep recording** on the chip. A meeting can be excluded by a "Don't record" toggle on its row, stored in `meta.noRecord` on the calendar event's item.

## 6. Transcripts

### Live

`src/domain/meetings/live.ts` buffers PCM from the controller. Every 5 s it writes the last 30 s to a temp WAV and runs `whisper-cli -m <base.en> -f <wav> -nt -otxt` (no timestamps, text only), then merges the new text into `meta.liveTranscript` (an array of `{ at, text }`) by dropping the longest suffix of the previous segment that prefixes the new one. The meeting page shows the live transcript growing; polling `GET /api/items/<id>` every 3 s while `meta.recording.state === "recording"`.

### Final

`transcribe_final` (job handler `src/jobs/handlers/transcribe-final.ts`): converts the input to 16 kHz mono WAV with ffmpeg when needed, runs `whisper-cli -m <medium.en> -f <wav> -oj` for JSON segments with timestamps, writes `extractedText` (plain text) and `meta.transcript = [{ start, end, text }]`, sets `meta.final_transcript_ready = true`, clears `meta.liveTranscript`, enqueues `embed` and, when an Anthropic key resolves, `summarize_meeting`.

Models: `scripts/brain.sh setup` downloads `ggml-base.en.bin` into `$DATA_DIR/models/whisper/` if absent; `medium.en` is used from `~/.whisper-cpp/models/ggml-medium.en.bin` when present, otherwise downloaded to the same folder. `whisper-cli` and `ffmpeg` are resolved from PATH and Homebrew's prefix; a setup card on the Meetings view names any missing tool with the `brew install` line.

### Summary

`summarize_meeting` calls the chat provider's `structured` with the transcript and the notes body, returning `{ summary, decisions: string[], proposed_actions: { title, notes }[] }` into `meta.summary`. Without a key the job is skipped and the meeting page shows "Add an Anthropic key in Settings to get summaries" once.

### Dropped-in recordings

Uploading `m4a`, `mp3`, `wav`, `webm`, or `ogg` through Capture or the prompt bar creates a `meeting` item titled from the file name and enqueues `transcribe_final`.

## 7. Meeting page

`/items/<id>` for `type = meeting`, on carbon with the rail:

- Header: title (editable), when (date, time range in mono), organizer, attendee chips, Join button, the recording state (Record, Recording with elapsed time and Stop, Transcribing, Done).
- Body: two panes above 1100 px: **Notes** (the block editor on `body`) and **Transcript** (live segments while recording; final segments with `mm:ss` timestamps, a filter box, and "Copy transcript"; "No transcript yet" with a Record button otherwise). Below: **Summary** (`meta.summary.summary`), **Decisions**, and **Proposed actions** as rows with an editable title and an "Add as task" button that creates a task with `sourceItemId` and marks the row accepted.
- Rail: Details (type, when, calendar, recording file size and duration), Attendees, Linked tasks (tasks whose `sourceItemId` is this meeting).

## 8. Data

- `daily_plan_entries` (date, task_id, sort_order; unique on date and task) per the master spec.
- `calendar_events` gains `organizer`, `attendee_names` (JSON), `location`, `join_url`, `notes`, `all_day`, `status`, `calendar_title`, `item_id` (link to the meeting item once captured; replaces the lookup in `findCapturedMeetingItem`).
- Items of type `meeting` use `meta`: `recording`, `liveTranscript`, `transcript`, `final_transcript_ready`, `summary`, `acceptedActions` (indices), `noRecord`.
- Settings: `meetings.autoRecord`, `meetings.autoRecordNeedsCallLink`, `meetings.whisperBase`, `meetings.whisperFinal` (model paths, filled by setup).

## 9. Chrome and motion

Carbon tokens throughout. The timeline's current-time line is violet with a small dot; meeting blocks are `pane` with a violet left bar while recording. The recording chip pulses its dot (`motion-safe`); the Planner's segmented control slides a violet indicator between views; drag-and-drop uses the existing task-row drag with a violet drop line. No middle dots; `.micro` for pane labels.

## 10. Accessibility

Timeline blocks are buttons with a full label ("Product sync, 10:30 to 11:00, 4 attendees, recording"); the segmented control is a `tablist`; drag targets have keyboard equivalents (the "Plan for" popover and the due-date field); the recording chip's Stop is a button with `aria-live="polite"` status text; every state change also reaches a toast.

## 11. Testing

Domain: plan reorder and carry-over; auto-start window selection (edge cases: declined, all-day, no link, already recorded, one running); join URL extraction; live transcript merge; transcript JSON parsing; summary skipped without a key. Recorder controller against a fake `sb-recorder` (a Node script that emits PCM and honours SIGINT), whisper invocation against a fake `whisper-cli` on PATH. UI: Planner views render from fixtures, the Record and Stop flow updates the chip, the meeting page shows live then final transcript, proposed actions create tasks. Screenshots: Day, Week, Meetings, a meeting page while recording and after, the dock chip.

## 12. Implementation order

Two plans:

1. **Planner and calendar**: migration 0007, helper calendar depth and status, setup cards, daily plan domain and APIs, the Planner page with Day, Week, and Meetings views, the dock's Planner item and Today redirect, "Plan for today" in task rows.
2. **Recording and transcripts**: recorder helper and setup, controller and APIs, dock recording chip, live and final transcription, the meeting page, auto-start scheduler and settings, summary job, dropped-in audio.
