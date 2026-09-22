import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { stopRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Signals the recording helper, and takes no body, so a cross-origin post needs no preflight: gate it. */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const status = await stopRecording();
    return NextResponse.json({ ...status, missing: checkTools(getDb()).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
