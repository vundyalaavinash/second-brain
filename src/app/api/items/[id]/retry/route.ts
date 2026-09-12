import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getItem } from "@/domain/items";
import { retryFailedJobsForItem } from "@/jobs/queue";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    if (!getItem(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ retried: retryFailedJobsForItem(db, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
