import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFeedState, syncCalendarFeed } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** "Sync now": the same pull the five-minute tick makes. */
export async function POST(): Promise<Response> {
  try {
    const db = getDb();
    const sync = await syncCalendarFeed(db, { log: (m) => console.log(`[calendar-feed] ${m}`) });
    return NextResponse.json({ ...getFeedState(db), sync });
  } catch (err) {
    return errorResponse(err);
  }
}
