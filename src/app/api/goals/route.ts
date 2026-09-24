import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { createGoal, goalsWithMeasure } from "@/domain/goals";
import { crossSite, errorResponse, forbidden, serializeGoal } from "@/lib/api";
import { CreateGoalBody } from "@/lib/validation";
import type { GoalStatus } from "@/db/enums";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const db = getDb();
    const raw = new URL(req.url).searchParams.get("status");
    const status = raw === null || raw === "" ? undefined : (raw as GoalStatus);
    const today = localDay(new Date().toISOString());
    return NextResponse.json({ goals: goalsWithMeasure(db, { status }, today).map(serializeGoal) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    // Parsed straight through zod: errorResponse maps a ZodError to 400, so a bad body never
    // reads as a 500 and this route needs no safeParse dance of its own.
    const body = CreateGoalBody.parse(await req.json());
    const db = getDb();
    const goal = createGoal(db, body);
    const today = localDay(new Date().toISOString());
    const [withMeasure] = goalsWithMeasure(db, { id: goal.id }, today);
    return NextResponse.json(serializeGoal(withMeasure), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
