import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { fillDay, placeTask } from "@/domain/blocks";
import { errorResponse } from "@/lib/api";
import { PlaceBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Places one task's sessions in the day's free slots, or fills the day when no task is named. */
export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = PlaceBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { date, taskId } = parsed.data;
    const db = getDb();
    return NextResponse.json(taskId === undefined ? fillDay(db, { date }) : placeTask(db, { taskId, date }));
  } catch (err) {
    return errorResponse(err);
  }
}
