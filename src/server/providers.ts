import { modelsDir } from "@/lib/paths";
import type { EmbedProvider } from "@/providers/embed/types";
import { createTransformersEmbedProvider } from "@/providers/embed/transformers";

const g = globalThis as unknown as { __sbEmbed?: EmbedProvider | null };

/** Returns null when SB_EMBED=off, which disables semantic search but keeps everything else working. */
export function getEmbedProvider(): EmbedProvider | null {
  if (g.__sbEmbed === undefined) {
    g.__sbEmbed = process.env.SB_EMBED === "off" ? null : createTransformersEmbedProvider({ cacheDir: modelsDir() });
  }
  return g.__sbEmbed;
}

export function setEmbedProviderForTests(p: EmbedProvider | null): void {
  g.__sbEmbed = p;
}
