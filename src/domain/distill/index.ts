import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items } from "@/db/schema";
import { enqueueJob } from "@/jobs/queue";
import { MIN_QUOTES, MIN_WORDS, suggestQuotes, verifyQuotes } from "./extract";
import type { GistProvider } from "@/providers/gist";

export const QUIET_MINUTES = 30;

export interface Distillation {
  gist: string;
  quotes: string[];
  generatedAt: string;
  status: "pending" | "kept" | "dismissed";
}

const DISTILLABLE_TYPES = ["note", "link", "file"] as const;

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/**
 * One grouped query for every eligible item, never a scan-then-check-each-row loop: type is
 * note/link/file, never archived, quiet for at least `QUIET_MINUTES`, and no `meta.distillation`
 * yet at all (pending, kept, or dismissed all count as "already has one" -- this never re-offers).
 * The word-count floor is applied in JS after the fetch, not in SQL, since `body`+`extractedText`
 * length isn't worth a generated column for a sweep that runs a few times an hour over a personal
 * database.
 */
export function candidateItemsForDistillation(db: DB, now: Date): number[] {
  const cutoff = new Date(now.getTime() - QUIET_MINUTES * 60_000).toISOString();
  const rows = db
    .select({ id: items.id, body: items.body, extractedText: items.extractedText })
    .from(items)
    .where(
      and(
        inArray(items.type, [...DISTILLABLE_TYPES]),
        isNull(items.archivedAt),
        lt(items.updatedAt, cutoff),
        sql`json_extract(${items.meta}, '$.distillation') IS NULL`,
      ),
    )
    .all();
  return rows.filter((r) => wordCount(`${r.body} ${r.extractedText}`) >= MIN_WORDS).map((r) => r.id);
}

/**
 * Extracts quotes with no model (`extract.ts`), verifies each is genuinely present in the
 * source, and -- only once at least `MIN_QUOTES` survive -- asks the local model to paraphrase
 * exactly those already-selected quotes into a gist. Returns null when there isn't enough real
 * material to offer, rather than a half-broken distillation.
 */
export async function buildDistillation(
  item: { body: string; extractedText: string },
  gist: GistProvider,
): Promise<Distillation | null> {
  const source = `${item.body}\n${item.extractedText}`;
  const suggested = suggestQuotes(source);
  const quotes = verifyQuotes(source, suggested);
  if (quotes.length < MIN_QUOTES) return null;
  const paragraph = await gist.gist(quotes);
  return { gist: paragraph, quotes, generatedAt: new Date().toISOString(), status: "pending" };
}

/** Finds this run's candidates and enqueues one job per item -- the sweep itself does no model
 * work; `distill-note.ts`'s job handler does, so each item's inference is independently retryable
 * and logged through the same job-worker plumbing every other content job already uses. */
export function distillSweepTick(db: DB, now: Date = new Date()): void {
  for (const itemId of candidateItemsForDistillation(db, now)) enqueueJob(db, "distill_note", { itemId }, itemId);
}
