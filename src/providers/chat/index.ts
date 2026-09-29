import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "@/lib/paths";
import { resolveTool } from "@/domain/meetings/tools";
import { createLlamaCppChatProvider } from "./llamacpp";
import type { ChatProvider } from "./types";

export type { ChatProvider, StructuredRequest } from "./types";

/** Where `scripts/brain.sh setup`'s `download_summary_model` step puts the model file -- the
 * same layout src/providers/gist/index.ts uses for its own, smaller model. */
export function summaryModelPath(): string {
  return path.join(modelsDir(), "summary", "model.gguf");
}

/** A missing model means this feature is off, not broken -- same shape as `hasGistModel`. */
export function hasSummaryModel(): boolean {
  return fs.existsSync(summaryModelPath());
}

export function summaryBinary(): string | null {
  return resolveTool("llama-cli");
}

/** Null when the model or the binary is absent: every caller (today, just summarize-meeting.ts)
 * already treats that as "this feature is off" -- it used to mean no Anthropic key, now it means
 * no local model yet. */
export function getChatProvider(): ChatProvider | null {
  if (!hasSummaryModel()) return null;
  const bin = summaryBinary();
  if (!bin) return null;
  return createLlamaCppChatProvider(summaryModelPath(), bin);
}
