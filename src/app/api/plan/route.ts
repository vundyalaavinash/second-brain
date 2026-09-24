import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addToPlan, listPlan, removeFromPlan, reorderPlan, unfinished } from "@/domain/plan";
import { addDays } from "@/domain/activity";
import { errorResponse, serializePlanTasks, serializeTasks } from "@/lib/api";
import { DateString, PlanBody, ReorderPlanBody } from "@/lib/validation";
import type { PlanDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** A plan is one day's, so the rows it answers with carry that day's sessions and no others. */
function dayWindow(date: string): { from: string; to: string } {
  return { from: date, to: addDays(date, 1) };
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
      tasks: serializePlanTasks(db, listPlan(db, date), dayWindow(date)),
      unfinishedYesterday: serializeTasks(db, unfinished(db, addDays(date, -1)), dayWindow(date)),
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
    return NextResponse.json({ date: parsed.data.date, tasks: serializePlanTasks(db, listPlan(db, parsed.data.date), dayWindow(parsed.data.date)) }, { status: 201 });
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
    return NextResponse.json({ date: parsed.data.date, tasks: serializePlanTasks(db, listPlan(db, parsed.data.date), dayWindow(parsed.data.date)) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const parsed = ReorderPlanBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.message);
    const db = getDb();
    const tasks = serializePlanTasks(db, reorderPlan(db, parsed.data.date, parsed.data.taskIds), dayWindow(parsed.data.date));
    return NextResponse.json({ date: parsed.data.date, tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
