export const EMBEDDING_DIMENSIONS = 384;

export interface EmbedProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
