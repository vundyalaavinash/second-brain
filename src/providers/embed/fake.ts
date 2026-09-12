import { EMBEDDING_DIMENSIONS, type EmbedProvider } from "./types";

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Deterministic bag-of-words hashing embedder for tests. Similar texts land close together. */
export function createFakeEmbedProvider(): EmbedProvider {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const v = new Float32Array(EMBEDDING_DIMENSIONS);
        const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
        for (const w of words) v[fnv1a(w) % EMBEDDING_DIMENSIONS] += 1;
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < v.length; i++) v[i] /= norm;
        return v;
      });
    },
  };
}
