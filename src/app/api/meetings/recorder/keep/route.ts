import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { keepRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** "Keep recording" on the chip, and the auto-stop rule's way of being told to stand down. */
export async function POST(): Promise<Response> {
  try {
    const status = keepRecording();
    return NextResponse.json({ ...status, missing: checkTools(getDb()).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
