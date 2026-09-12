export interface FusedResult<T> {
  key: number;
  score: number;
  item: T;
}

/** Reciprocal rank fusion: score = sum over lists of 1 / (k + rank), rank starting at 1. */
export function reciprocalRankFusion<T>(lists: T[][], key: (t: T) => number, k = 60): FusedResult<T>[] {
  const scores = new Map<number, FusedResult<T>>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const id = key(item);
      const add = 1 / (k + index + 1);
      const existing = scores.get(id);
      if (existing) existing.score += add;
      else scores.set(id, { key: id, score: add, item });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.key - b.key);
}
