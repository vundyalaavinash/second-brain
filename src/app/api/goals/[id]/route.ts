import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { closeGoal, deleteGoal, getGoal, goalsWithMeasure, recentCloses, reopenGoal, updateGoal } from "@/domain/goals";
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
    const { status, ...fields } = PatchGoalBody.parse(await req.json());
    const db = getDb();
    // Existence is checked either by the update itself, or, when the patch carries nothing but
    // a status, by hand — a status-only patch never touches updateGoal at all.
    if (Object.keys(fields).length) updateGoal(db, id, fields);
    else if (!getGoal(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (status === "active") reopenGoal(db, id);
    else if (status !== undefined) closeGoal(db, id, status);
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
