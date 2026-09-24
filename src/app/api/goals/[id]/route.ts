import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { deleteGoal, goalsWithMeasure, recentCloses, updateGoal } from "@/domain/goals";
import { containerProgress } from "@/domain/tasks";
import { crossSite, errorResponse, forbidden, parseId, serializeGoal } from "@/lib/api";
import { PatchGoalBody } from "@/lib/validation";
import type { GoalDetailDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** How many of a goal's most recently closed tasks its detail page carries. */
const RECENT_CLOSES = 10;

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const today = localDay(new Date().toISOString());
    const [goal] = goalsWithMeasure(db, { id }, today);
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const progress = containerProgress(db, goal.containers.map((c) => c.id));
    const detail: GoalDetailDTO = {
      ...serializeGoal(goal),
      links: goal.containers.map((container) => ({ container, progress: progress.get(container.id)! })),
      recentCloses: recentCloses(db, id, RECENT_CLOSES),
    };
    return NextResponse.json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    // A body that is not JSON at all reads as null rather than throwing here, so it fails the
    // schema the same way any other bad body does instead of leaking a raw SyntaxError as a 500.
    const patch = PatchGoalBody.parse(await req.json().catch(() => null));
    const db = getDb();
    // updateGoal owns the status/closedAt invariant itself — a status of "active" reopens, any
    // other status closes, and it 404s on its own when the goal does not exist.
    updateGoal(db, id, patch);
    const today = localDay(new Date().toISOString());
    const [goal] = goalsWithMeasure(db, { id }, today);
    return NextResponse.json(serializeGoal(goal));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    deleteGoal(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
