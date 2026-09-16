import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { captureMeeting, findCapturedMeetingItem } from "@/domain/activity";
import { errorResponse, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const existed = !!findCapturedMeetingItem(db, id);
    const item = captureMeeting(db, id);
    return NextResponse.json(serializeItem(db, item), { status: existed ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
