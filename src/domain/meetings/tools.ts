import fs from "node:fs";
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
  /** Keys of the fields above that came back null, in that order. */
  missing: string[];
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
  return tools;
}
