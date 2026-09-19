import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getHelperState, isPaused } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    return NextResponse.json({ helper: getHelperState(db), paused: isPaused(db) });
  } catch (err) {
    return errorResponse(err);
  }
}
