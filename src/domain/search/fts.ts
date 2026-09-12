import type { DB } from "@/db/client";
import { filterSql, type SearchFilter } from "./filter";

export interface ChunkHit {
  chunkId: number;
  itemId: number;
  text: string;
  score: number;
}

/** Turn free text into an FTS5 query: each term quoted, prefix-matched, OR-joined. Null when no terms. */
export function buildFtsQuery(raw: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" OR ");
}

export function ftsSearch(db: DB, query: string, opts: { limit: number; filter?: SearchFilter }): ChunkHit[] {
  const q = buildFtsQuery(query);
  if (!q) return [];
  const { where, params } = filterSql(opts.filter);
  const rows = db.$client
    .prepare(
      `SELECT c.id AS chunkId, c.item_id AS itemId, c.text AS text, bm25(chunks_fts) AS rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN items i ON i.id = c.item_id
       WHERE chunks_fts MATCH ?${where}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(q, ...params, opts.limit) as { chunkId: number; itemId: number; text: string; rank: number }[];
  return rows.map((r) => ({ chunkId: r.chunkId, itemId: r.itemId, text: r.text, score: -r.rank }));
}
