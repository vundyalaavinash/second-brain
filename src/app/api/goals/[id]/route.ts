import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { deleteGoal, goalsWithMeasure, updateGoal } from "@/domain/goals";
import { crossSite, errorResponse, forbidden, goalDetail, parseId, serializeGoal } from "@/lib/api";
import { PatchGoalBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const today = localDay(new Date().toISOString());
    const detail = goalDetail(db, id, today);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
