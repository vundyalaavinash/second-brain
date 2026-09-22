import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { startRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { errorResponse } from "@/lib/api";
import { StartRecordingBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
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
