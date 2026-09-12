import type { DB } from "@/db/client";
import { filterSql, type SearchFilter } from "./filter";
import { toBlob } from "./vectors";
import type { ChunkHit } from "./fts";

/** Nearest chunks by cosine distance. Filters run after the KNN, so the KNN fetches extra candidates. */
export function vectorSearch(db: DB, vector: Float32Array, opts: { limit: number; filter?: SearchFilter }): ChunkHit[] {
  const { where, params } = filterSql(opts.filter);
  const candidates = opts.limit * 4;
  const rows = db.$client
    .prepare(
      `SELECT v.rowid AS chunkId, v.distance AS distance, c.item_id AS itemId, c.text AS text
       FROM (SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?) v
       JOIN chunks c ON c.id = v.rowid
       JOIN items i ON i.id = c.item_id
       WHERE 1 = 1${where}
       ORDER BY v.distance
       LIMIT ?`,
    )
    .all(toBlob(vector), candidates, ...params, opts.limit) as { chunkId: number; distance: number; itemId: number; text: string }[];
  return rows.map((r) => ({ chunkId: r.chunkId, itemId: r.itemId, text: r.text, score: 1 - r.distance }));
}
