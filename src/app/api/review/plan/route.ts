import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addToPlan } from "@/domain/plan";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { ReviewPlanBody } from "@/lib/validation";
import { weekStart } from "@/lib/week";

export const dynamic = "force-dynamic";

/** Adds each task to the first day of the named week — Monday, the only day a review ever plans
 * into, so `week` is normalized the same way `GET /api/review` normalizes it — through the same
 * `addToPlan` the Planner itself calls, so a task landed here needs no second look before it
 * shows up there. Duplicate ids in the same request count once. */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const body = ReviewPlanBody.parse(await req.json().catch(() => null));
    const week = weekStart(body.week);
    const db = getDb();
    const ids = [...new Set(body.taskIds)];
    for (const id of ids) addToPlan(db, week, id);
    return NextResponse.json({ planned: ids.length });
  } catch (err) {
    return errorResponse(err);
  }
}
