import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "@/lib/paths";
import { createLlamaCppGistProvider } from "./llamacpp";
import type { GistProvider } from "./types";

export type { GistProvider } from "./types";

/** Where `scripts/brain.sh setup`'s `download_gist_model` step puts the model file. */
export function gistModelPath(): string {
  return path.join(modelsDir(), "gist", "model.gguf");
}

/** Same on/off shape as `hasChatKey`: a missing model means this feature is off, not broken. */
export function hasGistModel(): boolean {
  return fs.existsSync(gistModelPath());
}

/** Null when the model is absent: every caller treats that as "this feature is off". */
export function getGistProvider(): GistProvider | null {
  return hasGistModel() ? createLlamaCppGistProvider(gistModelPath()) : null;
}
