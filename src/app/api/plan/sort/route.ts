import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sortPlanByTime } from "@/domain/plan";
import { errorResponse, serializePlanTask } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";
const Body = z.object({ date: DateString }).strict();

/** Reorders the day's plan to follow its blocks; unblocked rows keep their order at the end. */
export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json({ date: parsed.data.date, tasks: sortPlanByTime(getDb(), parsed.data.date).map(serializePlanTask) });
  } catch (err) {
    return errorResponse(err);
  }
}
