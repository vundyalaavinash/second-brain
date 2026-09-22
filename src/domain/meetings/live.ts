import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DB } from "@/db/client";
import { getItem, parseMeta, updateItem } from "@/domain/items";

const run = promisify(execFile);

/** One window of live text, stamped with the wall clock it was heard at. */
export interface LiveSegment {
  at: string;
  text: string;
}

export const SAMPLE_RATE = 16_000;
const BYTES_PER_FRAME = 2;
/** The rolling window whisper sees: long enough to give it context, short enough to stay fast. */
export const ROLLING_SECONDS = 30;
const ROLLING_BYTES = SAMPLE_RATE * BYTES_PER_FRAME * ROLLING_SECONDS;
const DEFAULT_WINDOW_MS = 5000;
/** A base-model pass over 30 s takes a second or two; past this the window is a lost cause. */
const WHISPER_TIMEOUT_MS = 60_000;

/** A 44-byte RIFF header for `dataLength` bytes of 16 kHz mono 16-bit PCM. */
export function wavHeader(dataLength: number): Buffer {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataLength, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24);
  b.writeUInt32LE(SAMPLE_RATE * BYTES_PER_FRAME, 28);
  b.writeUInt16LE(BYTES_PER_FRAME, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataLength, 40);
  return b;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Fold one window of live text into what is already there.
 *
 * Each window overlaps the one before it, so whisper repeats itself: the longest run of
 * words that ends what came before and begins the new window is the overlap, and only what
 * follows it is new. A window that repeats everything adds nothing.
 */
export function mergeTranscript(previous: LiveSegment[], text: string, at: string): LiveSegment[] {
  const fresh = words(text);
  if (fresh.length === 0) return previous;

  const seen = words(previous.map((s) => s.text).join(" "));
  const compare = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

  let overlap = 0;
  for (let k = Math.min(seen.length, fresh.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (!compare(seen[seen.length - k + i], fresh[i])) {
        same = false;
        break;
      }
    }
    if (same) {
      overlap = k;
      break;
    }
  }

  const added = fresh.slice(overlap).join(" ");
  if (!added) return previous;
  return [...previous, { at, text: added }];
}

export interface LiveTranscriberDeps {
  db: DB;
  itemId: number;
  whisperBin: string;
  model: string;
  windowMs?: number;
  /** Where the scratch WAV goes; a temp directory by default. */
  tmpDir?: string;
  log?: (message: string) => void;
}

/**
 * Runs the base whisper model over a rolling window of the recorder's PCM while the meeting
 * is still going, so the item has something to read before the final pass. It is strictly
 * best effort: a failed window is logged once and the recording carries on.
 */
export class LiveTranscriber {
  private buffer: Buffer = Buffer.alloc(0);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  private loggedError = false;
  private readonly dir: string;
  /** Only a directory this transcriber made is a directory it may delete. */
  private readonly ownsDir: boolean;
  private readonly base: string;

  constructor(private readonly deps: LiveTranscriberDeps) {
    this.ownsDir = !deps.tmpDir;
    this.dir = deps.tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "sb-live-"));
    fs.mkdirSync(this.dir, { recursive: true });
    this.base = path.join(this.dir, `live-${deps.itemId}`);
  }

  /** Where the scratch WAV for each window is written. */
  get scratchDir(): string {
    return this.dir;
  }

  /** Append PCM from the recorder, keeping only the last window. */
  push(chunk: Buffer): void {
    if (this.stopped) return;
    const grown = Buffer.concat([this.buffer, chunk]);
    this.buffer = grown.length <= ROLLING_BYTES ? grown : grown.subarray(-ROLLING_BYTES);
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.runWindow(), this.deps.windowMs ?? DEFAULT_WINDOW_MS);
    this.timer.unref?.();
  }

  /** Ends the session. A window still running finishes into the void: its text is dropped. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const suffix of [".wav", ".txt"]) fs.rmSync(`${this.base}${suffix}`, { force: true });
    if (this.ownsDir) fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Exposed for tests and for the first window: transcribe what is buffered right now. */
  async runWindow(): Promise<void> {
    if (this.busy || this.stopped || this.buffer.length === 0) return;
    this.busy = true;
    const wav = `${this.base}.wav`;
    try {
      const pcm = this.buffer;
      fs.writeFileSync(wav, Buffer.concat([wavHeader(pcm.length), pcm]));
      await run(this.deps.whisperBin, ["-m", this.deps.model, "-f", wav, "-nt", "-otxt", "-of", this.base], {
        timeout: WHISPER_TIMEOUT_MS,
      });
      const text = fs.readFileSync(`${this.base}.txt`, "utf8").replace(/\s+/g, " ").trim();
      if (text && !this.stopped) this.record(text);
    } catch (err) {
      if (!this.loggedError) {
        this.loggedError = true;
        const message = err instanceof Error ? err.message : String(err);
        (this.deps.log ?? ((m: string) => console.warn("[live]", m)))(`live transcription is off for this session: ${message}`);
      }
    } finally {
      this.busy = false;
    }
  }

  private record(text: string): void {
    const item = getItem(this.deps.db, this.deps.itemId);
    if (!item) return;
    const meta = parseMeta<{ liveTranscript?: LiveSegment[] }>(item);
    const previous = meta.liveTranscript ?? [];
    const merged = mergeTranscript(previous, text, new Date().toISOString());
    if (merged === previous) return;
    updateItem(this.deps.db, this.deps.itemId, { meta: { ...meta, liveTranscript: merged } });
  }
}
