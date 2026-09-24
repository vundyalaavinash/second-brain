import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { goalsWithMeasure, setGoalLinks } from "@/domain/goals";
import { crossSite, errorResponse, forbidden, parseId, serializeGoal } from "@/lib/api";
import { GoalLinksBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Replaces the goal's whole set of linked containers and answers the refreshed goal. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    // A body that is not JSON at all reads as null rather than throwing here, so it fails the
    // schema the same way any other bad body does instead of leaking a raw SyntaxError as a 500.
    const { containerIds } = GoalLinksBody.parse(await req.json().catch(() => null));
    const db = getDb();
    setGoalLinks(db, id, containerIds);
    const today = localDay(new Date().toISOString());
    const [goal] = goalsWithMeasure(db, { id }, today);
    return NextResponse.json(serializeGoal(goal));
  } catch (err) {
    return errorResponse(err);
  }
}
