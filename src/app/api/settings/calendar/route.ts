import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getFeedState, getOutlookState, setFeedUrl, setOutlookEnabled, syncCalendarFeed, syncOutlookWidget } from "@/domain/activity";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z
  .object({ feedUrl: z.string().max(2048).optional(), outlookEnabled: z.boolean().optional() })
  .strict()
  .refine((b) => b.feedUrl !== undefined || b.outlookEnabled !== undefined, "Nothing to change");

/** The published calendar link the app polls, and how its last sync went. */
export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    return NextResponse.json({ ...getFeedState(db), outlook: getOutlookState(db) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Saving a link syncs it straight away, so the answer already says whether it worked. */
export async function PATCH(req: Request): Promise<Response> {
  try {
    // The server fetches whatever link is saved: no other site gets to choose it.
    if (crossSite(req)) return forbidden();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    let sync;
    if (parsed.data.feedUrl !== undefined) {
      try {
        setFeedUrl(db, parsed.data.feedUrl);
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
      sync = await syncCalendarFeed(db, { log: (m) => console.log(`[calendar-feed] ${m}`) });
    }
    // Switching Outlook on syncs immediately so the answer already says whether it found
    // anything; switching it off deletes what it synced, and reports how much it removed.
    let outlookSync;
    let removed = 0;
    if (parsed.data.outlookEnabled !== undefined) {
      removed = setOutlookEnabled(db, parsed.data.outlookEnabled).removed;
      if (parsed.data.outlookEnabled) {
        outlookSync = syncOutlookWidget(db, { log: (m) => console.log(`[calendar-outlook] ${m}`) });
      }
    }
    return NextResponse.json({
      ...getFeedState(db),
      outlook: getOutlookState(db),
      ...(sync ? { sync } : {}),
      ...(outlookSync ? { outlookSync } : {}),
      ...(removed ? { removed } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
