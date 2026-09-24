import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sortPlanByTime } from "@/domain/plan";
import { addDays } from "@/domain/activity";
import { errorResponse, serializePlanTasks } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";
const Body = z.object({ date: DateString }).strict();

/** Reorders the day's plan to follow its blocks; unblocked rows keep their order at the end. */
export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const date = parsed.data.date;
    // The day it sorted, and the sessions of that day alone.
    return NextResponse.json({ date, tasks: serializePlanTasks(db, sortPlanByTime(db, date), { from: date, to: addDays(date, 1) }) });
  } catch (err) {
    return errorResponse(err);
  }
}
