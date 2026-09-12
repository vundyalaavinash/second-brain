import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ITEM_TYPES } from "@/db/schema";
import { search } from "@/domain/search";
import { getEmbedProvider } from "@/server/providers";
import { errorResponse, serializeItem } from "@/lib/api";
import type { SearchResultDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().default(""),
  type: z.enum(ITEM_TYPES).optional(),
  tag: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const raw = Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => v !== ""));
    const parsed = Query.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { q, limit, ...filter } = parsed.data;
    const db = getDb();
    const results = await search(db, getEmbedProvider(), q, filter, limit);
    const body: SearchResultDTO[] = results.map((r) => ({
      item: serializeItem(db, r.item),
      snippet: r.snippet,
      score: r.score,
      chunkId: r.chunkId,
    }));
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
