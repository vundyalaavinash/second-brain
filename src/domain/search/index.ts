import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type Item } from "@/db/schema";
import type { EmbedProvider } from "@/providers/embed/types";
import { ftsSearch, type ChunkHit } from "./fts";
import { vectorSearch } from "./vector";
import { reciprocalRankFusion } from "./fuse";
import type { SearchFilter } from "./filter";

export type { SearchFilter } from "./filter";

export interface SearchResult {
  item: Item;
  snippet: string;
  score: number;
  chunkId: number;
}

const CANDIDATES = 50;

export async function search(
  db: DB,
  embed: EmbedProvider | null,
  query: string,
  filter: SearchFilter = {},
  limit = 20,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const keyword = ftsSearch(db, trimmed, { limit: CANDIDATES, filter });
  let semantic: ChunkHit[] = [];
  if (embed) {
    try {
      const [vector] = await embed.embed([trimmed]);
      semantic = vectorSearch(db, vector, { limit: CANDIDATES, filter });
    } catch (err) {
      console.warn(`[search] semantic search unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const fused = reciprocalRankFusion([keyword, semantic], (h) => h.chunkId);
  const best = new Map<number, { hit: ChunkHit; score: number }>();
  for (const f of fused) {
    if (!best.has(f.item.itemId)) best.set(f.item.itemId, { hit: f.item, score: f.score });
    if (best.size >= limit) break;
  }
  const ids = [...best.keys()];
  if (ids.length === 0) return [];
  const rows = db.select().from(items).where(inArray(items.id, ids)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    const entry = best.get(id);
    if (!item || !entry) return [];
    return [{ item, snippet: makeSnippet(entry.hit.text, trimmed), score: entry.score, chunkId: entry.hit.chunkId }];
  });
}

/** A window of `width` characters around the first query term found in text. */
export function makeSnippet(text: string, query: string, width = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= width) return clean;
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const lower = clean.toLowerCase();
  let pos = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
  }
  if (pos === -1) return `${clean.slice(0, width - 1)}…`;
  const start = Math.max(0, pos - Math.floor(width / 3));
  const end = Math.min(clean.length, start + width);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}
