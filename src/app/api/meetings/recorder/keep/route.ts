import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { keepRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * "Keep recording" on the chip, and the auto-stop rule's way of being told to stand down.
 * It takes no body either, so it carries the same origin gate as start and stop.
 */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const status = keepRecording();
    return NextResponse.json({ ...status, missing: checkTools(getDb()).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
