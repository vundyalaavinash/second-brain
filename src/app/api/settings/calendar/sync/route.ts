import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFeedState, syncCalendarFeed } from "@/domain/activity";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

/** "Sync now": the same pull the five-minute tick makes. */
export async function POST(req: Request): Promise<Response> {
  try {
    // An outbound fetch on demand is a side effect no other site may trigger.
    if (crossSite(req)) return forbidden();
    const db = getDb();
    const sync = await syncCalendarFeed(db, { log: (m) => console.log(`[calendar-feed] ${m}`) });
    return NextResponse.json({ ...getFeedState(db), sync });
  } catch (err) {
    return errorResponse(err);
  }
}
