import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { GOAL_STATUSES } from "@/db/enums";
import { localDay } from "@/domain/activity";
import { createGoal, goalsWithMeasure } from "@/domain/goals";
import { crossSite, errorResponse, forbidden, serializeGoal } from "@/lib/api";
import { CreateGoalBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ListParams = z.object({ status: z.enum(GOAL_STATUSES).optional() });

export async function GET(req: Request): Promise<Response> {
  try {
    const raw = new URL(req.url).searchParams.get("status");
    const parsed = ListParams.safeParse({ status: raw === null || raw === "" ? undefined : raw });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const today = localDay(new Date().toISOString());
    return NextResponse.json({ goals: goalsWithMeasure(db, { status: parsed.data.status }, today).map(serializeGoal) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    // Parsed straight through zod: errorResponse maps a ZodError to 400, so a bad body never
    // reads as a 500. A body that is not JSON at all reads as null instead of throwing here, so
    // it fails the same schema check rather than leaking the parser's own SyntaxError.
    const body = CreateGoalBody.parse(await req.json().catch(() => null));
    const db = getDb();
    const goal = createGoal(db, body);
    const today = localDay(new Date().toISOString());
    const [withMeasure] = goalsWithMeasure(db, { id: goal.id }, today);
    return NextResponse.json(serializeGoal(withMeasure), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
