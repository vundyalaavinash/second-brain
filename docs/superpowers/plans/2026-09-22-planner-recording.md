# Recording and Transcripts Implementation Plan (Planner plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record meetings (system audio plus mic) into a meeting item, transcribe live and finally with whisper.cpp, show notes and transcript side by side on the meeting page, start recordings by themselves when meetings begin, and summarise with Claude when a key is present.

**Architecture:** A Swift `sb-recorder` binary captures audio to a 16 kHz WAV and streams PCM on stdout. A Node controller (`domain/meetings/recorder.ts`) owns one session, spawns the binary, feeds a live transcriber (`domain/meetings/live.ts`) that shells out to `whisper-cli`, and enqueues `transcribe_final` on stop. The job worker gains `transcribe_final` and `summarize_meeting` handlers; a scheduler tick in `boot.ts` starts recordings for meetings that just began. The dock shows a recording chip; the meeting page renders notes, transcript, summary, and proposed actions.

**Tech Stack:** Swift 6 (Core Audio process tap on macOS 14.2+, AVAudioEngine mic), Node `child_process`, `whisper-cli` and `ffmpeg` from Homebrew, Next.js 16, React 19 (react-compiler lint), Drizzle, zod 4, Vitest 5 (jsdom via `// @vitest-environment jsdom`), `@anthropic-ai/sdk` (new dependency, exact pin).

**Spec:** `docs/superpowers/specs/2026-09-22-planner-design.md` (binding), sections 2 (recording chip), 5, 6, 7, 8 (meta and settings), 9, 10, 11, 12 item 2.

## Global Constraints

- Carbon tokens; `.pane`/`.panel`/`.micro`; sentence case; no middle dots; focus rings; motion under reduced-motion guards; no `setState` synchronously in effect bodies; hydration deterministic; behaviour freeze outside each task's files.
- One recording session at a time; a second `start` returns 409. Nothing recorded is ever discarded: helper crashes keep the WAV and still enqueue `transcribe_final`.
- External binaries are resolved at runtime (`whisper-cli`, `ffmpeg` from `PATH` and `/opt/homebrew/bin`); every place that needs them reports a clear setup message when missing; tests never invoke real binaries (fake executables on `PATH` or injected functions).
- Model paths: `meetings.whisperBase` and `meetings.whisperFinal` settings, filled by `scripts/brain.sh setup`; defaults `$DATA_DIR/models/whisper/ggml-base.en.bin` and `~/.whisper-cpp/models/ggml-medium.en.bin` when present.
- `npm test && npm run lint && npm run build` pristine at the end of every task; `swift build -c release` clean in `helper/recorder`. Do not start a server on port 3141; do not run `scripts/brain.sh`.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`.

---

## File structure

| File | Responsibility |
|---|---|
| `helper/recorder/Package.swift`, `Sources/sb-recorder/main.swift`, `Capture.swift`, `Wav.swift` | the recorder binary |
| `scripts/brain.sh` | build/install the recorder, download `base.en`, write model settings, `--probe` at setup |
| `src/domain/meetings/tools.ts` (+test) | resolve `whisper-cli`/`ffmpeg`, model paths, `checkTools()` |
| `src/domain/meetings/recorder.ts` (+test) | session controller |
| `src/domain/meetings/live.ts` (+test) | PCM buffer, 5 s window, `mergeTranscript` |
| `src/domain/meetings/transcript.ts` (+test) | whisper JSON → segments, plain text |
| `src/domain/meetings/index.ts` | `startRecording`, `stopRecording`, `recorderStatus`, `createAdhocMeeting`, meeting meta helpers |
| `src/jobs/handlers/transcribe-final.ts`, `summarize-meeting.ts` (+tests) | jobs |
| `src/providers/chat/{types,anthropic,index}.ts` | `ChatProvider.structured`, key resolution |
| `src/app/api/meetings/recorder/route.ts`, `start/route.ts`, `stop/route.ts`, `src/app/api/meetings/[id]/actions/route.ts`, `src/app/api/settings/meetings/route.ts` | APIs |
| `src/components/dock/recording-chip.tsx` (+test), `dock.tsx` | the chip |
| `src/components/meeting/meeting-page.tsx`, `transcript-pane.tsx`, `summary-pane.tsx`, `meeting-rail.tsx` (+tests), `src/app/items/[id]/page.tsx` | the meeting page |
| `src/components/planner/meeting-row.tsx`, `meetings-view.tsx`, `timeline.tsx` | Record buttons live |
| `src/server/boot.ts`, `src/domain/meetings/auto-start.ts` (+test) | scheduler |
| `src/domain/items/capture.ts` | dropped-in audio |

---

### Task 1: Recorder helper, tools, transcript parsing, setup script

**Files:**
- Create: `helper/recorder/Package.swift`, `helper/recorder/Sources/sb-recorder/main.swift`, `Capture.swift`, `Wav.swift`, `src/domain/meetings/tools.ts`, `tools.test.ts`, `src/domain/meetings/transcript.ts`, `transcript.test.ts`
- Modify: `scripts/brain.sh`, `README.md` (setup lines)

**Interfaces:**
- Produces: `sb-recorder <wav-path>` (records until SIGINT; WAV 16 kHz mono 16-bit; PCM on stdout as raw LE16; JSON lines on stderr: `{"state":"recording","systemAudio":true|false}` on start, `{"state":"error","message":…}` on failure); `sb-recorder --probe` (2 s to a temp file, exit 0/1). `resolveTool(name): string | null`, `checkTools(db): { whisper: string | null; ffmpeg: string | null; recorder: string | null; baseModel: string | null; finalModel: string | null; missing: string[] }`; `parseWhisperJson(json: string): Segment[]` with `Segment = { start: number; end: number; text: string }` (seconds); `segmentsToText(segments): string`; settings keys `meetings.whisperBase`, `meetings.whisperFinal`; `RECORDER_BIN = $DATA_DIR/bin/sb-recorder`.

- [ ] **Step 1: Failing tests**

```ts
// src/domain/meetings/transcript.test.ts
import { describe, it, expect } from "vitest";
import { parseWhisperJson, segmentsToText } from "./transcript";
const sample = JSON.stringify({ transcription: [
  { timestamps: { from: "00:00:00,000", to: "00:00:02,500" }, offsets: { from: 0, to: 2500 }, text: " Hello there." },
  { timestamps: { from: "00:00:02,500", to: "00:00:05,000" }, offsets: { from: 2500, to: 5000 }, text: " Second line." },
] });
describe("parseWhisperJson", () => {
  it("maps offsets to seconds and trims text", () => {
    expect(parseWhisperJson(sample)).toEqual([{ start: 0, end: 2.5, text: "Hello there." }, { start: 2.5, end: 5, text: "Second line." }]);
  });
  it("joins segments into plain text", () => {
    expect(segmentsToText(parseWhisperJson(sample))).toBe("Hello there. Second line.");
  });
  it("throws a readable error on malformed input", () => {
    expect(() => parseWhisperJson("{}")).toThrow(/transcription/);
  });
});
```

```ts
// src/domain/meetings/tools.test.ts — uses the in-memory db helper and a temp dir on PATH
it("resolves tools from PATH and reports what is missing", () => {
  // create a temp dir with an executable `whisper-cli` and prepend it to process.env.PATH inside the test
  const t = checkTools(db);
  expect(t.whisper).toMatch(/whisper-cli$/);
  expect(t.missing).toContain("ffmpeg"); // when the temp dir has no ffmpeg and /opt/homebrew/bin is excluded via a `pathDirs` option
});
```

Give `checkTools(db, opts?: { pathDirs?: string[] })` an injectable directory list so the test does not depend on the machine.

- [ ] **Step 2: Implement tools and transcript**

`tools.ts`: `resolveTool(name, dirs = [...process.env.PATH.split(":"), "/opt/homebrew/bin", "/usr/local/bin"])` returns the first existing executable; `checkTools` reads model settings (`getSetting`) with the defaults above and checks `fs.existsSync`; `recorder` is `$DATA_DIR/bin/sb-recorder`. `transcript.ts` per the tests (whisper `-oj` output shape: `transcription[].offsets.from/to` in ms, `text`).

- [ ] **Step 3: Recorder helper**

`Package.swift` mirrors `helper/activity/Package.swift` (name `sb-recorder`, platforms macOS 14). `main.swift`: parse args (`--probe` or a WAV path); `Capture.swift`: prefer a Core Audio process tap of the default output device (`CATapDescription` with `AudioHardwareCreateProcessTap` and an aggregate device, available on macOS 14.2+) mixed with the default input through `AVAudioEngine`; if the tap cannot be created (API unavailable or permission denied), fall back to microphone only and report `"systemAudio": false` in the start line. Convert to 16 kHz mono Int16 with `AVAudioConverter`; `Wav.swift` writes the RIFF header with placeholder sizes and patches them on close; each converted buffer is appended to the file and written to stdout (`FileHandle.standardOutput`). Handle SIGINT/SIGTERM with a `DispatchSource.makeSignalSource` that stops the engine, closes the WAV, and exits 0. `--probe` runs two seconds then exits (macOS prompts for microphone and, for the tap, audio capture permission).

- [ ] **Step 4: Setup script and README**

`scripts/brain.sh`: `build_recorder()` (like `build_helper`, source `helper/recorder`, binary `$DATA_DIR/bin/sb-recorder`), called from `cmd_setup` after `build_helper`; `download_whisper_models()`: create `$DATA_DIR/models/whisper/`, download `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` if missing (`curl -L`), and set the settings through a `node -e` snippet writing `meetings.whisperBase` and `meetings.whisperFinal` (`~/.whisper-cpp/models/ggml-medium.en.bin` if present, else download `ggml-medium.en.bin` too); run `"$DATA_DIR/bin/sb-recorder" --probe` once with a note about the permission prompts; `cmd_status` prints `recorder: ok|missing`, `whisper: ok|missing`, `ffmpeg: ok|missing`. README: a "Meetings and recording" section with the tools (`brew install whisper-cpp ffmpeg`), the permissions, and where recordings live.

- [ ] **Step 5: Verify and commit**

`npm test && npm run lint && npm run build`; `cd helper/recorder && swift build -c release` (paste the tail into the report); `bash -n scripts/brain.sh`.

```bash
git add -A helper/recorder src scripts README.md
git commit -m "feat(meetings): recorder helper, tool resolution, whisper transcript parsing, setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Recorder controller, live transcription, APIs, dock chip, Record buttons, dropped-in audio

**Files:**
- Create: `src/domain/meetings/recorder.ts`, `recorder.test.ts`, `live.ts`, `live.test.ts`, `index.ts`, `src/app/api/meetings/recorder/route.ts`, `src/app/api/meetings/recorder/start/route.ts`, `src/app/api/meetings/recorder/stop/route.ts`, `src/components/dock/recording-chip.tsx`, `recording-chip.test.tsx`, `src/test/fake-recorder.js`, `src/test/fake-whisper.js`, `src/jobs/handlers/transcribe-final.ts`, `transcribe-final.test.ts`
- Modify: `src/components/dock/dock.tsx`, `src/components/planner/meeting-row.tsx`, `meetings-view.tsx`, `timeline.tsx` (Record wired), `src/domain/items/capture.ts` (audio), `src/jobs/handlers/index.ts`, `src/lib/dto.ts`, `src/lib/validation.ts`

**Interfaces:**
- Produces: `Recorder` class (`recorder.ts`) with `start(target, opts): { itemId, startedAt }`, `stop(): Promise<void>`, `status(): RecorderStatus`, events `change`; singleton via `getRecorder(db)` in `index.ts`; `RecorderStatus = { state: "idle" | "recording" | "stopping" | "error"; itemId?: number; title?: string; startedAt?: string; systemAudio?: boolean; error?: string; autoStarted?: boolean }`; `startRecording(db, target: { calendarEventId?: number; itemId?: number; adhoc?: boolean }, opts?: { autoStarted?: boolean })`; `stopRecording(db)`; `recorderStatus()`; `createAdhocMeeting(db, now): Item` (title "Meeting at HH:MM"); `mergeTranscript(previous: LiveSegment[], text: string, at: string): LiveSegment[]` with `LiveSegment = { at: string; text: string }`; routes `GET /api/meetings/recorder` → `RecorderStatus`, `POST …/start { calendarEventId? | itemId? | adhoc? }` → status (409 when recording), `POST …/stop` → status; `sb:recording-changed` window event; `transcribe_final` handler; `captureFile` creates a `meeting` item for audio and enqueues `transcribe_final` with `{ itemId, source: "upload" }`.

- [ ] **Step 1: Failing tests**

`live.test.ts`: `mergeTranscript([], "hello there", t1)` → one segment; `mergeTranscript([{at: t1, text: "hello there how"}], "there how are you", t2)` → the second segment is "are you" (longest suffix of the previous text that prefixes the new one is dropped); identical text → no new segment.

`recorder.test.ts`: with `recorderBin` pointed at `src/test/fake-recorder.js` (a Node script: prints `{"state":"recording","systemAudio":true}` to stderr, writes a minimal WAV header plus zeros to the path, emits 3200 zero bytes to stdout every 100 ms, exits 0 on SIGINT after patching the header) and `whisperBin` at `src/test/fake-whisper.js` (prints `hello world` for `-otxt` and a fixed JSON for `-oj`): `start({ adhoc: true })` creates a meeting item with `meta.recording.state === "recording"` and `status().state === "recording"`; a second `start` throws with `status 409`; after ≥ 5.2 s (use `vi.useFakeTimers` around the live window, or an injectable `windowMs: 200`), `meta.liveTranscript` has a segment; `stop()` resolves, `meta.recording.state === "done"`, a `transcribe_final` job is queued for the item; a fake that exits unexpectedly leaves `state: "error"` and still queues the job.

`recording-chip.test.tsx`: renders nothing when idle; with `state: "recording"` shows the dot, elapsed time in mono (`00:12` with a fake `Date.now`), the title, Stop button (`POST /api/meetings/recorder/stop` on click) and a Keep recording button when `autoStarted`.

`transcribe-final.test.ts`: with `whisperBin` at the fake and `ffmpeg` injected as a no-op for WAV input: sets `extractedText`, `meta.transcript` (segments), `meta.final_transcript_ready: true`, clears `liveTranscript`, enqueues `embed`; with a chat key present (inject `hasChatKey: () => true`) also enqueues `summarize_meeting`; a missing WAV marks the item `failed` with a message.

- [ ] **Step 2: Implement**

`recorder.ts`:

```ts
export class Recorder extends EventEmitter {
  private proc: ChildProcess | null = null;
  private current: RecorderStatus = { state: "idle" };
  private live: LiveTranscriber | null = null;
  constructor(private deps: { db: DB; recorderBin: string; whisperBin: string | null; baseModel: string | null; filesDir: string; windowMs?: number }) { super(); }
  status(): RecorderStatus { return { ...this.current }; }
  start(item: Item, opts: { autoStarted?: boolean } = {}): { itemId: number; startedAt: string } {
    if (this.current.state === "recording" || this.current.state === "stopping") throw new MeetingError("A recording is already running", 409);
    const startedAt = new Date().toISOString();
    const wavPath = path.join("meetings", `${item.id}-${startedAt.replace(/[:.]/g, "-")}.wav`);
    fs.mkdirSync(path.join(this.deps.filesDir, "meetings"), { recursive: true });
    const abs = path.join(this.deps.filesDir, wavPath);
    const proc = spawn(this.deps.recorderBin, [abs], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    this.current = { state: "recording", itemId: item.id, title: item.title, startedAt, autoStarted: opts.autoStarted };
    updateItem(this.deps.db, item.id, { meta: { ...parseMeta(item), recording: { startedAt, wavPath, state: "recording", autoStarted: !!opts.autoStarted } } });
    proc.stderr.on("data", (chunk) => this.onStderr(String(chunk)));
    if (this.deps.whisperBin && this.deps.baseModel) {
      this.live = new LiveTranscriber({ db: this.deps.db, itemId: item.id, whisperBin: this.deps.whisperBin, model: this.deps.baseModel, windowMs: this.deps.windowMs ?? 5000 });
      proc.stdout.on("data", (chunk: Buffer) => this.live?.push(chunk));
      this.live.start();
    } else proc.stdout.resume();
    proc.on("exit", (code) => this.onExit(code));
    this.emit("change", this.status());
    return { itemId: item.id, startedAt };
  }
  async stop(): Promise<void> {
    if (!this.proc || this.current.state !== "recording") return;
    this.current = { ...this.current, state: "stopping" };
    this.emit("change", this.status());
    const proc = this.proc;
    proc.kill("SIGINT");
    await new Promise<void>((resolve) => { const t = setTimeout(() => { proc.kill("SIGTERM"); }, 10_000); proc.once("exit", () => { clearTimeout(t); resolve(); }); });
  }
  private onExit(code: number | null) {
    const itemId = this.current.itemId!;
    const item = getItem(this.deps.db, itemId);
    const meta = item ? parseMeta(item) : {};
    const recording = { ...(meta.recording as object), state: this.current.state === "stopping" || code === 0 ? "done" : "error", endedAt: new Date().toISOString() };
    if (item) updateItem(this.deps.db, itemId, { meta: { ...meta, recording } });
    this.live?.stop(); this.live = null; this.proc = null;
    enqueueJob(this.deps.db, "transcribe_final", { itemId, source: "recording" }, itemId);
    this.current = recording.state === "error" ? { state: "error", itemId, error: `recorder exited with ${code}` } : { state: "idle" };
    this.emit("change", this.status());
  }
  private onStderr(text: string) { for (const line of text.split("\n")) { if (!line.trim()) continue; try { const j = JSON.parse(line); if (j.state === "recording") this.current = { ...this.current, systemAudio: !!j.systemAudio }; if (j.state === "error") this.current = { ...this.current, error: j.message }; } catch { /* plain log line */ } } }
}
```

`live.ts`: `LiveTranscriber` keeps a rolling `Buffer` of the last 30 s (16 000 × 2 × 30 bytes); every `windowMs` it writes a temp WAV (header + buffer), runs `execFile(whisperBin, ["-m", model, "-f", tmp, "-nt", "-otxt", "-of", tmpBase])`, reads `tmpBase.txt`, and calls `mergeTranscript` into `meta.liveTranscript` via `updateItem`; overlapping runs are skipped (a `busy` flag); errors are logged once per session and do not stop recording. `mergeTranscript` per the tests.

`index.ts`: `getRecorder(db)` builds the singleton from `checkTools(db)` (throws `MeetingError(…, 503)` with the missing-tools message when the recorder binary is absent); `startRecording` resolves the item (`captureMeeting` for `calendarEventId`; `getItem` for `itemId`, must be type `meeting`; `createAdhocMeeting` for `adhoc`) and calls `recorder.start`; after `stop` it emits `sb:recording-changed` semantics by returning the status (the UI dispatches the window event).

Routes as listed (`MeetingError` → its status). `transcribe-final.ts`: resolve the WAV (`meta.recording.wavPath` or the item's `filePath` for uploads); if not 16 kHz mono WAV, `ffmpeg -y -i in -ar 16000 -ac 1 -c:a pcm_s16le out.wav`; run `whisper-cli -m <finalModel> -f <wav> -oj -of <base>`; parse; update `extractedText`, `meta.transcript`, `meta.final_transcript_ready`, delete `meta.liveTranscript`; `rechunkItem`; enqueue `embed`; enqueue `summarize_meeting` when `deps.hasChatKey()` (Task 3 provides the real function; here inject a default that checks `ANTHROPIC_API_KEY` or the `anthropic.apiKey` setting). Register in `handlers/index.ts` with `HandlerDeps` gaining `whisperBin?`, `ffmpegBin?`, `hasChatKey?`.

`capture.ts` audio branch: save the file, create `{ type: "meeting", title: name without extension, filePath, mimeType, status: "processing", meta: { kind: "audio", size } }`, enqueue `transcribe_final` `{ itemId, source: "upload" }`.

`recording-chip.tsx`: polls `GET /api/meetings/recorder` every 5 s while not idle and on `sb:recording-changed`; renders left of the dock pill (`absolute right-full mr-3`), a `panel rounded-full h-11 px-3 flex items-center gap-2`: red dot (`bg-danger`, `motion-safe:animate-pulse`), elapsed `mm:ss` mono (from `startedAt`, ticked by an interval), the title as a `Link` to `/items/<itemId>`, "Keep recording" (when `autoStarted`, posts `POST /api/meetings/recorder/keep` → add that route setting `keep: true` on the status), and Stop (`aria-label="Stop recording"`); `aria-live="polite"` on the status text. `dock.tsx` renders it. Record buttons in `meeting-row.tsx`, `meetings-view.tsx` ("Record now" → `adhoc`), and `timeline.tsx` become live: `POST /api/meetings/recorder/start` with `{ calendarEventId }`, then dispatch `sb:recording-changed`; disabled with the tools message when `GET /api/meetings/recorder` reports `missing` (add `missing: string[]` to the status payload from `checkTools`).

- [ ] **Step 3: Verify and commit**

```bash
git add -A src
git commit -m "feat(meetings): recorder controller, live transcription, final transcript job, dock chip, record buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Meeting page, chat provider, summaries, proposed actions

**Files:**
- Create: `src/providers/chat/types.ts`, `anthropic.ts`, `index.ts`, `src/jobs/handlers/summarize-meeting.ts`, `summarize-meeting.test.ts`, `src/components/meeting/meeting-page.tsx`, `transcript-pane.tsx`, `summary-pane.tsx`, `meeting-rail.tsx`, `meeting-page.test.tsx`, `src/app/api/meetings/[id]/actions/route.ts`
- Modify: `src/app/items/[id]/page.tsx` (route meeting items to `MeetingPage`), `src/jobs/handlers/index.ts`, `src/server/boot.ts` (pass `hasChatKey`), `package.json` (`@anthropic-ai/sdk` exact pin)

**Interfaces:**
- Produces: `ChatProvider { structured<T>(req: { system: string; user: string; schema: z.ZodType<T>; name: string }): Promise<T> }`; `getChatProvider(db): ChatProvider | null` (key from `ANTHROPIC_API_KEY` or setting `anthropic.apiKey`; model `claude-opus-5`, `thinking: { type: "adaptive" }`, tool-use with the zod schema converted by `z.toJSONSchema` for structured output); `hasChatKey(db): boolean`; `summarize_meeting` handler → `meta.summary = { summary, decisions, proposed_actions }`; `POST /api/meetings/[id]/actions { index, title }` creates a task with `sourceItemId` and records `meta.acceptedActions`; `MeetingPage({ item, tasks })` server-fed, client component.

- [ ] **Step 1: Failing tests**

`summarize-meeting.test.ts`: with a fake `ChatProvider` returning a fixed object, the handler writes `meta.summary`; when `getChatProvider` returns null the handler resolves without changes and logs once. `meeting-page.test.tsx` (jsdom): renders title, time range, attendee chips; shows "No transcript yet" with a Record button when nothing recorded; shows live segments when `meta.recording.state === "recording"` and `meta.liveTranscript` has entries; shows final segments with `mm:ss` and a filter box when `meta.transcript` exists; "Add as task" on a proposed action posts to `/api/meetings/<id>/actions` and marks the row accepted.

- [ ] **Step 2: Implement**

`anthropic.ts`: `new Anthropic({ apiKey })`, `messages.create({ model: "claude-opus-5", max_tokens: 4000, thinking: { type: "adaptive" }, system, tools: [{ name, input_schema: z.toJSONSchema(schema) }], tool_choice: { type: "tool", name }, messages: [{ role: "user", content: user }] })`, take the `tool_use` block's `input`, `schema.parse` it. `summarize-meeting.ts`: system prompt "You summarise meeting transcripts…", user content = transcript text plus the notes body; schema `{ summary: z.string(), decisions: z.array(z.string()), proposed_actions: z.array(z.object({ title: z.string(), notes: z.string() })) }`.

`meeting-page.tsx`: layout per spec section 7 on carbon with `<Crumb>` (parent Library or Planner Meetings when it has a calendar event) and `MeetingRail` (Details: when, calendar, recording duration and file size from the WAV; Attendees; Linked tasks); header with title input (same autosave as the item editor via the existing `persist`-style PATCH of `title`), when, organizer, attendee chips, Join, recording state control (Record / Recording with elapsed and Stop / Transcribing / Done); two panes above 1100 px: Notes (`RichEditor` on `body` with the item editor's 5 s autosave, ⌘S flush) and `TranscriptPane` (live: segments append with a "Listening" pulse; final: segments with `mm:ss`, filter `Input`, "Copy transcript" button using `navigator.clipboard`; polling `GET /api/items/<id>` every 3 s while recording or while the item is `processing` after a recording); `SummaryPane` (summary, decisions list, proposed actions rows with editable title and "Add as task", "Add an Anthropic key in Settings to get summaries" line when no key and no summary). `src/app/items/[id]/page.tsx` renders `MeetingPage` for `type === "meeting"` and the existing editor otherwise.

- [ ] **Step 3: Verify and commit**

```bash
git add -A src package.json package-lock.json
git commit -m "feat(meetings): meeting page with live and final transcript, summaries via Claude, proposed actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: Auto-start scheduler, settings, screenshots, README

**Files:**
- Create: `src/domain/meetings/auto-start.ts`, `auto-start.test.ts`, `src/app/api/settings/meetings/route.ts`
- Modify: `src/server/boot.ts`, `src/components/planner/meetings-view.tsx` (auto-record toggle in the header), `src/components/dock/recording-chip.tsx` (Keep recording), `README.md`

**Interfaces:**
- Produces: `pickAutoStart(db, now, settings): CalendarEvent | null` (starts within [now − 2 min, now + 1 min], `status !== "declined"`, not all-day, `joinUrl` required when `autoRecordNeedsCallLink`, no `meta.recording` on its item, `no_record` false); `autoStopDue(status, db, now): boolean` (auto-started, `now > endsAt + 5 min`, `keep` not set); `GET/PATCH /api/settings/meetings` `{ autoRecord: boolean; autoRecordNeedsCallLink: boolean }`; the tick in `boot.ts` every 30 s (guarded by a global like the backup interval) that starts/stops through the recorder and logs.

- [ ] **Step 1: Failing tests**

`auto-start.test.ts`: fixtures for each exclusion (declined, all-day, no link with the setting on, already recorded, `no_record`, outside the window) and one match; `autoStopDue` true after end + 5 min unless `keep`.

- [ ] **Step 2: Implement**

Per the interfaces; the tick catches and logs errors (never throws out of the interval); when the recorder is busy the tick does nothing; on auto-start it also writes `meta.recording.autoStarted = true` (Task 2's `opts.autoStarted`). The Meetings view header gets a toggle "Record meetings automatically" (a `Chip` acting as a switch, `role="switch"`, `aria-checked`) and, when on, a smaller "Only with a join link" switch; both PATCH the settings route. README: the auto-record behaviour and the two settings.

- [ ] **Step 3: Verify and commit**

The controller screenshots: Meetings with live Record buttons, the dock chip while recording (fake recorder on the scratch server), a meeting page live and final, the settings toggles.

```bash
git add -A src README.md
git commit -m "feat(meetings): auto-start recordings, settings, keep recording

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: §2 recording chip → Task 2; §5 helper, controller, auto-start → Tasks 1, 2, 4; §6 live, final, models, summary, dropped-in → Tasks 1 (models, parsing), 2 (live, final, dropped-in), 3 (summary); §7 meeting page → Task 3; §8 meta and settings → Tasks 1, 2, 4; §9 chrome and motion → chip and page classes in Tasks 2, 3; §10 a11y → chip `aria-live`, Stop button, tabpanel-free page; §11 tests → each task with fake binaries; §12 item 2 → this plan.
- Placeholders: none; the controller and merge algorithm are given in code, the whisper CLI flags are named, the Anthropic call shape is given.
- Type consistency: `RecorderStatus`, `startRecording/stopRecording/recorderStatus`, `mergeTranscript`, `LiveSegment`, `Segment`, `parseWhisperJson`, `checkTools`, `hasChatKey`, `getChatProvider`, `pickAutoStart`, `autoStopDue`, `sb:recording-changed`, routes named identically across tasks.
