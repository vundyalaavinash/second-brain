import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addToPlan, listPlan, removeFromPlan, reorderPlan, unfinished } from "@/domain/plan";
import { addDays } from "@/domain/activity";
import { errorResponse, serializePlanTask, serializeTask } from "@/lib/api";
import { DateString, PlanBody, ReorderPlanBody } from "@/lib/validation";
import type { PlanDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** One day's plan, plus what was still open on the day before, so the view can offer to carry it over. */
export async function GET(req: Request): Promise<Response> {
  try {
    const parsed = DateString.safeParse(new URL(req.url).searchParams.get("date"));
    if (!parsed.success) return badRequest("date must be YYYY-MM-DD");
    const date = parsed.data;
    const db = getDb();
    const body: PlanDTO = {
      date,
      tasks: listPlan(db, date).map(serializePlanTask),
      unfinishedYesterday: unfinished(db, addDays(date, -1)).map(serializeTask),
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = PlanBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.message);
    const db = getDb();
    addToPlan(db, parsed.data.date, parsed.data.taskId);
    return NextResponse.json({ date: parsed.data.date, tasks: listPlan(db, parsed.data.date).map(serializePlanTask) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const parsed = PlanBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.message);
    const db = getDb();
    removeFromPlan(db, parsed.data.date, parsed.data.taskId);
    return NextResponse.json({ date: parsed.data.date, tasks: listPlan(db, parsed.data.date).map(serializePlanTask) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const parsed = ReorderPlanBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.message);
    const tasks = reorderPlan(getDb(), parsed.data.date, parsed.data.taskIds).map(serializePlanTask);
    return NextResponse.json({ date: parsed.data.date, tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
