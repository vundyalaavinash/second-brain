import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { listTagNames, listTagsWithCounts } from "@/domain/items";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const db = getDb();
    const counts = new URL(req.url).searchParams.get("counts") === "1";
    return NextResponse.json(counts ? listTagsWithCounts(db) : listTagNames(db));
  } catch (err) {
    return errorResponse(err);
  }
}
