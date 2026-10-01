import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
import { getItem, parseMeta, updateItem } from "@/domain/items";
import { enqueueJob } from "@/jobs/queue";
import { MeetingError } from "./errors";
import { LiveTranscriber } from "./live";

/** How long a stopping recorder gets to patch its header before SIGTERM. */
const STOP_GRACE_MS = 10_000;

export type RecorderState = "idle" | "recording" | "stopping" | "error";

export interface RecorderStatus {
  state: RecorderState;
  itemId?: number;
  title?: string;
  startedAt?: string;
  systemAudio?: boolean;
  error?: string;
  /** True when a rule started this session rather than a person. */
  autoStarted?: boolean;
  /** Set once someone has said to keep an auto started session running. */
  keep?: boolean;
}

export interface RecordingMeta {
  startedAt: string;
  endedAt?: string;
  /** Relative to the files dir, so `absoluteFilePath` resolves it. */
  wavPath: string;
  state: "recording" | "done" | "error";
  autoStarted: boolean;
}

/**
 * Writes the end of a session onto the item. Shared with `reconcileRecordings`, which has to
 * close the same `meta.recording` for a session whose process died with the server.
 */
export function finishRecordingItem(db: DB, itemId: number, state: RecordingMeta["state"], endedAt: string = new Date().toISOString()): void {
  const item = getItem(db, itemId);
  if (!item) return;
  const meta = parseMeta<{ recording?: RecordingMeta }>(item);
  if (!meta.recording) return;
  updateItem(db, itemId, { meta: { ...meta, recording: { ...meta.recording, state, endedAt } } });
}

/** The one place the final pass is queued, so a reconciled session queues exactly what a live one does. */
export function queueFinalTranscript(db: DB, itemId: number): void {
  enqueueJob(db, "transcribe_final", { itemId, source: "recording" }, itemId);
}

export interface RecorderDeps {
  db: DB;
  recorderBin: string;
  whisperBin: string | null;
  baseModel: string | null;
  filesDir: string;
  windowMs?: number;
  log?: (message: string) => void;
}

interface RecorderLine {
  state?: string;
  systemAudio?: boolean;
  message?: string;
}

/**
 * One recording session at a time: spawns `sb-recorder`, keeps the item's `meta.recording`
 * in step with it, feeds the live transcriber from its stdout, and queues the final
 * transcript when it exits — however it exits, because the WAV is on disk either way.
 */
export class Recorder extends EventEmitter {
  private proc: ChildProcess | null = null;
  private current: RecorderStatus = { state: "idle" };
  private live: LiveTranscriber | null = null;

  constructor(private readonly deps: RecorderDeps) {
    super();
  }

  status(): RecorderStatus {
    return { ...this.current };
  }

  start(item: Item, opts: { autoStarted?: boolean } = {}): { itemId: number; startedAt: string } {
    if (this.current.state === "recording" || this.current.state === "stopping") {
      throw new MeetingError("A recording is already running", 409);
    }
    const startedAt = new Date().toISOString();
    const wavPath = path.join("meetings", `${item.id}-${startedAt.replace(/[:.]/g, "-")}.wav`);
    const absolute = path.join(this.deps.filesDir, wavPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });

    const proc = spawn(this.deps.recorderBin, [absolute], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    this.wavAbsolute = absolute;
    this.current = { state: "recording", itemId: item.id, title: item.title, startedAt, autoStarted: !!opts.autoStarted };

    const meta = parseMeta(item);
    const recording: RecordingMeta = { startedAt, wavPath, state: "recording", autoStarted: !!opts.autoStarted };
    updateItem(this.deps.db, item.id, { meta: { ...meta, recording }, status: "processing" });

    proc.stderr?.on("data", (chunk: Buffer) => this.onStderr(String(chunk)));
    if (this.deps.whisperBin && this.deps.baseModel) {
      const live = new LiveTranscriber({
        db: this.deps.db,
        itemId: item.id,
        whisperBin: this.deps.whisperBin,
        model: this.deps.baseModel,
        windowMs: this.deps.windowMs,
        log: this.deps.log,
      });
      this.live = live;
      proc.stdout?.on("data", (chunk: Buffer) => live.push(chunk));
      live.start();
    } else {
      // Nothing is listening for the PCM, so drain it: the helper stalls if it is not read.
      proc.stdout?.resume();
    }
    proc.on("error", (err) => this.onSpawnError(err));
    proc.on("exit", (code, signal) => this.onExit(code, signal));

    this.emit("change", this.status());
    return { itemId: item.id, startedAt };
  }

  /** Marks an auto started session as one to keep; the auto-stop rule reads this back. */
  keep(): RecorderStatus {
    if (this.current.state === "recording" || this.current.state === "stopping") {
      this.current = { ...this.current, keep: true };
      this.emit("change", this.status());
    }
    return this.status();
  }

  /** Ends the session, or clears a failed one. Resolves once the helper is gone. */
  async stop(): Promise<RecorderStatus> {
    if (this.current.state === "error") {
      this.current = { state: "idle" };
      this.emit("change", this.status());
      return this.status();
    }
    const proc = this.proc;
    if (!proc || this.current.state !== "recording") return this.status();

    this.current = { ...this.current, state: "stopping" };
    this.emit("change", this.status());
    proc.kill("SIGINT");
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => proc.kill("SIGTERM"), STOP_GRACE_MS);
      timer.unref?.();
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return this.status();
  }

  /** The last few non-JSON lines `sb-recorder` wrote, newest last — see `onStderr`. */
  private lastStderr: string[] = [];

  /** Where this session's WAV should be, so `onExit` can tell "no audio" from "some audio". */
  private wavAbsolute: string | null = null;

  /** The helper could not be spawned at all: no process, so `exit` never comes. */
  private onSpawnError(err: Error): void {
    const itemId = this.current.itemId;
    this.proc = null;
    this.live?.stop();
    this.live = null;
    if (itemId !== undefined) this.finishItem(itemId, "error");
    this.current = { state: "error", itemId, error: `recorder could not start: ${err.message}` };
    this.emit("change", this.status());
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    const itemId = this.current.itemId;
    const wasStopping = this.current.state === "stopping";
    this.proc = null;
    this.live?.stop();
    this.live = null;
    if (itemId === undefined) return;

    // An exit nobody asked for is a failure, including a null code: that is a signal, and
    // the only signals this helper gets are the ones `stop` sends. Inside the stopping window
    // a clean end is code 0 or a null code (the SIGINT we sent); any other code still failed.
    const failed = wasStopping ? code !== 0 && code !== null : code !== 0;
    this.finishItem(itemId, failed ? "error" : "done");

    // A partial WAV is still worth transcribing -- even a few seconds is a recording. But a
    // session that never wrote the file at all has nothing to transcribe, and queueing the pass
    // anyway buries the real failure under "The audio for item N is missing": the symptom talking
    // over the cause, which is exactly how a denied microphone came to look like a missing file.
    const hasAudio = this.wavAbsolute !== null && fs.existsSync(this.wavAbsolute);
    if (hasAudio) queueFinalTranscript(this.deps.db, itemId);

    // The helper's own reason, when it gave one, beats the exit code every time: "microphone
    // access denied" is actionable, "recorder exited with 1" is not. `onStderr` parks a reported
    // error on `current`, and this used to overwrite it wholesale with the generic text.
    const reported = this.current.state === "recording" || this.current.state === "stopping" ? this.current.error : undefined;
    const said = this.lastStderr.at(-1);
    const why = reported ?? `recorder exited with ${code ?? signal}${said ? `: ${said}` : ""}`;
    this.current = failed ? { state: "error", itemId, error: why } : { state: "idle" };
    if (failed) this.deps.log?.(`[recorder] ${why}${hasAudio ? "" : " (no audio was written, so no transcript was queued)"}`);
    this.lastStderr = [];
    this.wavAbsolute = null;
    this.emit("change", this.status());
  }

  private finishItem(itemId: number, state: RecordingMeta["state"]): void {
    finishRecordingItem(this.deps.db, itemId, state);
  }

  /**
   * The helper's JSON lines. None of them end the session: only the process exiting does.
   * A stalled stdout consumer means the PCM stream is gone but the WAV keeps growing, so
   * the live pass stops and the final transcript still comes off disk.
   */
  private onStderr(text: string): void {
    // Kept even once the session is over: a crash (SIGABRT from an uncatchable Objective-C
    // exception in CoreAudio, say) races the exit handler, and the last line before it is the
    // only explanation anyone gets. `onExit` reads it back so the error says something better
    // than the bare signal name.
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("{")) continue;
      this.lastStderr.push(t);
      if (this.lastStderr.length > 5) this.lastStderr.shift();
    }
    // A line that arrives after the session has ended has nothing left to describe.
    if (this.current.state !== "recording" && this.current.state !== "stopping") return;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: RecorderLine;
      try {
        parsed = JSON.parse(trimmed) as RecorderLine;
      } catch {
        this.deps.log?.(`[recorder] ${trimmed}`);
        continue;
      }
      if (parsed.state === "recording" || parsed.state === "device") {
        this.current = { ...this.current, systemAudio: !!parsed.systemAudio };
      }
      if (parsed.state === "error") {
        this.current = { ...this.current, error: parsed.message ?? "recorder error" };
        if (parsed.message === "stdout consumer stalled") {
          this.live?.stop();
          this.live = null;
        }
      }
    }
  }
}
