export interface ChunkOptions {
  maxWords: number;
  overlapWords: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxWords: 375, overlapWords: 40 };

/**
 * Split text into word windows. Paragraphs are packed together until maxWords,
 * oversize paragraphs are cut into maxWords slices, and every chunk after the
 * first is prefixed with the last overlapWords words of the previous chunk.
 */
export function chunkText(text: string, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  const base: string[][] = [];
  let current: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ");
    if (words.length > opts.maxWords) {
      if (current.length) {
        base.push(current);
        current = [];
      }
      for (let i = 0; i < words.length; i += opts.maxWords) {
        base.push(words.slice(i, i + opts.maxWords));
      }
      continue;
    }
    if (current.length + words.length > opts.maxWords) {
      base.push(current);
      current = [];
    }
    current = current.concat(words);
  }
  if (current.length) base.push(current);

  return base.map((words, i) => {
    if (i === 0) return words.join(" ");
    const prev = base[i - 1];
    const overlap = prev.slice(Math.max(0, prev.length - opts.overlapWords));
    return [...overlap, ...words].join(" ");
  });
}
