import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { countInbox, listItems } from "@/domain/items";
import { errorResponse, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
    const db = getDb();
    const items = listItems(db, { containerId: null, limit }).map((i) => serializeItem(db, i));
    return NextResponse.json({ count: countInbox(db), items });
  } catch (err) {
    return errorResponse(err);
  }
}
