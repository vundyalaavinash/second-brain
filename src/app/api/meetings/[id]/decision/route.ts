// `[id]` here is a calendar event id (`calendarEvents.id`), the same id space `../route.ts`
// (no-record) already uses — not the meeting item's id.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { setMeetingDecision } from "@/domain/meetings/decision";
import { MeetingError } from "@/domain/meetings/errors";
import { crossSite, errorResponse, forbidden, parseId, serializeMeetingResolved } from "@/lib/api";
import { MeetingDecisionBody } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Records a person's own decision on a meeting — never a message to the calendar server, only a
 * local fact this app keeps for itself (design §1.1). `scope: "series"` writes it against every
 * occurrence of the event's series instead of just this one; `setMeetingDecision` throws
 * `MeetingError(400)` when the event has no series to apply that to.
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    const parsed = MeetingDecisionBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    setMeetingDecision(db, id, parsed.data);
    const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
    if (!ev) throw new MeetingError("Meeting not found", 404);
    return NextResponse.json(serializeMeetingResolved(db, ev));
  } catch (err) {
    return errorResponse(err);
  }
}
