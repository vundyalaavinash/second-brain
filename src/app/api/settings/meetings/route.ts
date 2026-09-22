import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getAutoRecordSettings, setAutoRecordSettings } from "@/domain/meetings/auto-start";
import { errorResponse } from "@/lib/api";
import { MeetingSettingsBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** The two auto-record switches in the Meetings header. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(getAutoRecordSettings(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** A partial patch, so one switch can move without the view holding the other. */
export async function PATCH(req: Request): Promise<Response> {
  try {
    const parsed = MeetingSettingsBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(setAutoRecordSettings(getDb(), parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
