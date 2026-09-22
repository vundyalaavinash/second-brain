import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setMeetingNoRecord } from "@/domain/activity";
import { errorResponse, parseId, serializeMeeting } from "@/lib/api";
import { MeetingPatchBody } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = MeetingPatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(serializeMeeting(setMeetingNoRecord(getDb(), id, parsed.data.noRecord)));
  } catch (err) {
    return errorResponse(err);
  }
}
