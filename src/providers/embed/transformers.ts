import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_DIMENSIONS, type EmbedProvider } from "./types";

export const DEFAULT_EMBED_MODEL = "Xenova/bge-small-en-v1.5";

export interface TransformersEmbedOptions {
  cacheDir: string;
  model?: string;
}

/** In-process embeddings via transformers.js (ONNX). The model loads lazily on first use. */
export function createTransformersEmbedProvider(opts: TransformersEmbedOptions): EmbedProvider {
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  let loading: Promise<FeatureExtractionPipeline> | undefined;

  function load(): Promise<FeatureExtractionPipeline> {
    if (!loading) {
      loading = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = opts.cacheDir;
        return (await pipeline("feature-extraction", model, { dtype: "fp32" })) as FeatureExtractionPipeline;
      })();
    }
    return loading;
  }

  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const extractor = await load();
      const output = await extractor(texts, { pooling: "cls", normalize: true });
      const dims = output.dims[output.dims.length - 1];
      if (dims !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding model returned ${dims} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
      }
      const data = output.data as Float32Array;
      const vectors = texts.map((_, i) => data.slice(i * dims, (i + 1) * dims));
      output.dispose();
      return vectors;
    },
  };
}
