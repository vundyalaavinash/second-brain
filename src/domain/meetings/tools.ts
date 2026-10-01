import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { DB } from "@/db/client";
import { getSetting } from "@/domain/settings";
import { dataDir, modelsDir } from "@/lib/paths";

export const WHISPER_BASE_KEY = "meetings.whisperBase";
export const WHISPER_FINAL_KEY = "meetings.whisperFinal";

/** Where `scripts/brain.sh setup` installs the recorder helper. */
export function recorderBin(): string {
  return path.join(dataDir(), "bin", "sb-recorder");
}

export function whisperModelsDir(): string {
  return path.join(modelsDir(), "whisper");
}

/** PATH, plus the two Homebrew prefixes launchd agents do not inherit. */
export function defaultPathDirs(): string[] {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...fromPath, "/opt/homebrew/bin", "/usr/local/bin"];
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First executable named `name` in `dirs`, or null. */
export function resolveTool(name: string, dirs: string[] = defaultPathDirs()): string | null {
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export interface Tools {
  whisper: string | null;
  ffmpeg: string | null;
  recorder: string | null;
  baseModel: string | null;
  finalModel: string | null;
  /** Keys of the fields above that came back null, in that order, plus "microphone access" when
   * macOS will not let this process record. Everything can be installed and present and recording
   * still be impossible; that is the state this exists to make visible before a meeting rather
   * than after one. */
  missing: string[];
  microphone: MicrophoneAccess;
}

export type MicrophoneAccess = "authorized" | "denied" | "restricted" | "notDetermined" | "unknown";

/** Asking macOS costs a subprocess, and `checkTools` is on several hot paths; the answer only
 * changes when someone visits System Settings, so a short cache is plenty. */
let microphoneCache: { value: MicrophoneAccess; at: number } | null = null;
const MICROPHONE_TTL_MS = 30_000;

/**
 * What macOS will allow, asked without prompting and without recording. Permission belongs to the
 * process that asks, so this deliberately runs the same binary the recording itself would: asking
 * on behalf of some other process would answer a question nobody asked.
 */
export function microphoneAccess(recorder: string | null, now = Date.now()): MicrophoneAccess {
  if (!recorder) return "unknown";
  if (microphoneCache && now - microphoneCache.at < MICROPHONE_TTL_MS) return microphoneCache.value;
  let value: MicrophoneAccess = "unknown";
  try {
    const out = execFileSync(recorder, ["--permissions"], { timeout: 5000, encoding: "utf8" });
    const parsed = JSON.parse(out) as { microphone?: string };
    if (parsed.microphone) value = parsed.microphone as MicrophoneAccess;
  } catch {
    // An older helper without --permissions, or one that cannot run at all: unknown, never a
    // claim that access is fine.
    value = "unknown";
  }
  microphoneCache = { value, at: now };
  return value;
}

/** Test seam: the cache would otherwise carry one case's answer into the next. */
export function resetMicrophoneCache(): void {
  microphoneCache = null;
}

/**
 * Locate everything a recording needs. `pathDirs` is injectable so tests never
 * depend on what happens to be installed on the machine.
 */
export function checkTools(db: DB, opts: { pathDirs?: string[] } = {}): Tools {
  const dirs = opts.pathDirs ?? defaultPathDirs();
  const recorder = recorderBin();
  const basePath = getSetting(db, WHISPER_BASE_KEY, path.join(whisperModelsDir(), "ggml-base.en.bin"));
  const finalPath = getSetting(db, WHISPER_FINAL_KEY, path.join(whisperModelsDir(), "ggml-medium.en.bin"));

  const tools: Tools = {
    microphone: "unknown",
    whisper: resolveTool("whisper-cli", dirs),
    ffmpeg: resolveTool("ffmpeg", dirs),
    recorder: isExecutableFile(recorder) ? recorder : null,
    baseModel: fs.existsSync(basePath) ? basePath : null,
    finalModel: fs.existsSync(finalPath) ? finalPath : null,
    missing: [],
  };
  for (const key of ["whisper", "ffmpeg", "recorder", "baseModel", "finalModel"] as const) {
    if (tools[key] === null) tools.missing.push(key);
  }
  tools.microphone = microphoneAccess(tools.recorder);
  // "notDetermined" is not a problem: it means macOS has not asked yet, and starting a recording
  // is what asks. Only a refusal, or a restriction nobody here can lift, means it cannot work.
  if (tools.microphone === "denied" || tools.microphone === "restricted") tools.missing.push("microphone access");
  return tools;
}
