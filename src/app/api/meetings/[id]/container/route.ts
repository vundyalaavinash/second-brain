// `[id]` here is a calendar event id (`calendarEvents.id`), the same id space the sibling
// decision and no-record routes use — not the meeting item's id.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { assignMeetingContainer } from "@/domain/meetings/attribution";
import { MeetingError } from "@/domain/meetings/errors";
import { crossSite, errorResponse, forbidden, parseId, serializeMeetingResolved } from "@/lib/api";
import { MeetingContainerBody } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Assigns a meeting to the project or area it counts against, so the time it costs shows up
 * against that work rather than vanishing into the calendar.
 *
 * `scope: "series"` assigns every occurrence of the event's series — the common case for a
 * recurring meeting, and the reason this is cheap to keep up to date: a standup is labelled once
 * and stays labelled, including the occurrences that already happened.
 * `assignMeetingContainer` throws `MeetingError(400)` when the event has no series to apply that
 * to, rather than quietly writing a single-occurrence assignment nobody asked for.
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    const parsed = MeetingContainerBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    assignMeetingContainer(db, id, parsed.data.containerId, parsed.data.scope);
    const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
    if (!ev) throw new MeetingError("Meeting not found", 404);
    return NextResponse.json(serializeMeetingResolved(db, ev));
  } catch (err) {
    return errorResponse(err);
  }
}
