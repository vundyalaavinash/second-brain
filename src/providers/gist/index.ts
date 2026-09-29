import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "@/lib/paths";
import { resolveTool } from "@/domain/meetings/tools";
import { createLlamaCppGistProvider } from "./llamacpp";
import type { GistProvider } from "./types";

export type { GistProvider } from "./types";

/** Where `scripts/brain.sh setup`'s `download_gist_model` step puts the model file. */
export function gistModelPath(): string {
  return path.join(modelsDir(), "gist", "model.gguf");
}

/** Same on/off shape as `hasSummaryModel`: a missing model means this feature is off, not broken. */
export function hasGistModel(): boolean {
  return fs.existsSync(gistModelPath());
}

export function gistBinary(): string | null {
  return resolveTool("llama-cli");
}

/** Null when the model or the binary is absent: every caller treats that as "this feature is
 * off" -- a bare, unresolved `llama-cli` command name would otherwise throw ENOENT deep inside
 * the job handler the moment a real distillation ran. */
export function getGistProvider(): GistProvider | null {
  if (!hasGistModel()) return null;
  const bin = gistBinary();
  if (!bin) return null; // off, not broken -- same shape as a missing model file
  return createLlamaCppGistProvider(gistModelPath(), bin);
}
