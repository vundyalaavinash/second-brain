// `[id]` here is a calendar event id (`calendarEvents.id`), not an item id.
// Its `actions` child takes the meeting item's id instead: two id spaces, one path prefix.
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setMeetingNoRecord } from "@/domain/activity";
import { errorResponse, parseId, serializeMeetingResolved } from "@/lib/api";
import { MeetingPatchBody } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = MeetingPatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(serializeMeetingResolved(db, setMeetingNoRecord(db, id, parsed.data.noRecord)));
  } catch (err) {
    return errorResponse(err);
  }
}
