import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { stopRecording } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const status = await stopRecording();
    return NextResponse.json({ ...status, missing: checkTools(getDb()).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
