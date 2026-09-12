import { and, eq, isNull, like } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type Item } from "@/db/schema";

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|ref|mc_cid|mc_eid)$/i;

/** Canonical form of a url for duplicate detection. Throws on an invalid url. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING_PARAM.test(k)) kept.append(k, v);
  u.search = kept.toString() ? `?${kept.toString()}` : "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** The active link item whose url normalises to the same value, if any. */
export function findLinkByUrl(db: DB, url: string): Item | undefined {
  let target: string;
  let host: string;
  try {
    target = normalizeUrl(url);
    host = new URL(target).host;
  } catch {
    return undefined;
  }
  const candidates = db
    .select()
    .from(items)
    .where(and(eq(items.type, "link"), isNull(items.archivedAt), like(items.sourceUrl, `%${host}%`)))
    .all();
  for (const c of candidates) {
    if (!c.sourceUrl) continue;
    try {
      if (normalizeUrl(c.sourceUrl) === target) return c;
    } catch {
      /* skip unparsable stored urls */
    }
  }
  return undefined;
}
