import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { startRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { StartRecordingBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Spawns the recording helper, so it is gated on the origin like the other local-process routes. */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const parsed = StartRecordingBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const status = startRecording(db, parsed.data);
    return NextResponse.json({ ...status, missing: checkTools(db).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
