import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { completedToday } from "@/domain/focus";
import { breakState, endBreak, nextBreakMinutes, startBreak } from "@/domain/focus/break";
import { localDay } from "@/domain/activity";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The break between pomodoros. It lives server-side so it survives navigation: as a component's
 * own countdown it was cancelled silently the moment someone opened another page.
 *
 * `minutes` is optional on purpose -- left out, the length is whatever the pomodoro cycle says it
 * should be next, which is the normal case and saves every caller re-deriving it.
 */
const StartBreakBody = z.object({ minutes: z.number().int().min(1).max(60).optional() }).nullable();

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(breakState(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const body = StartBreakBody.parse(await req.json().catch(() => null));
    const db = getDb();
    const now = new Date();
    const minutes = body?.minutes ?? nextBreakMinutes(db, completedToday(db, localDay(now.toISOString())));
    return NextResponse.json(startBreak(db, minutes, now), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Back to work before the clock ran out. Idempotent: ending a break nobody is on is not an error. */
export async function DELETE(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    return NextResponse.json(endBreak(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}
