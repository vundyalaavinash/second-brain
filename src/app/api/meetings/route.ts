import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api";
import { plannerMeetings } from "@/lib/planner";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Meetings starting on a day in `[from, to)`; `q` matches title, organizer, or an attendee. */
export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    const from = DateString.safeParse(sp.get("from"));
    const to = DateString.safeParse(sp.get("to"));
    if (!from.success || !to.success) return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
    return NextResponse.json({ meetings: plannerMeetings(getDb(), { from: from.data, to: to.data, q: sp.get("q") ?? undefined }) });
  } catch (err) {
    return errorResponse(err);
  }
}
