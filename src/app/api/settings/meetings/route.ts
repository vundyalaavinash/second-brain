import { NextResponse } from "next/server";
import { getDb, type DB } from "@/db/client";
import { getAutoRecordSettings, setAutoRecordSettings } from "@/domain/meetings/auto-start";
import { audioRetentionDays, setAudioRetentionDays } from "@/domain/meetings/audio-retention";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { MeetingSettingsBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

function settings(db: DB) {
  return { ...getAutoRecordSettings(db), audioRetentionDays: audioRetentionDays(db) };
}

/** The two auto-record switches in the Meetings header, plus design §9's audio retention window. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(settings(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** A partial patch, so one field can move without the others holding it. Gated on `crossSite`
 * like every other settings PATCH -- this route's own pre-existing gap, the same one the
 * planner settings route's PATCH had before the forecast slice fixed it. */
export async function PATCH(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const parsed = MeetingSettingsBody.parse(await req.json().catch(() => null));
    const db = getDb();
    setAutoRecordSettings(db, parsed);
    if (parsed.audioRetentionDays !== undefined) setAudioRetentionDays(db, parsed.audioRetentionDays);
    return NextResponse.json(settings(db));
  } catch (err) {
    return errorResponse(err);
  }
}
