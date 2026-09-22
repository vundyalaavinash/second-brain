import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recorderStatus } from "@/domain/meetings";
import { checkTools } from "@/domain/meetings/tools";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The session, plus what the machine is still missing so the Record buttons can say so. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ ...recorderStatus(), missing: checkTools(getDb()).missing });
  } catch (err) {
    return errorResponse(err);
  }
}
