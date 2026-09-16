import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ActivityError, getDay, getHelperState, isPaused, listCategories, retentionDays } from "@/domain/activity";
import { errorResponse } from "@/lib/api";
import type { ActivityDayDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActivityError("date must be YYYY-MM-DD");
    const db = getDb();
    const dto: ActivityDayDTO = {
      ...getDay(db, date),
      categories: listCategories(db),
      helper: getHelperState(db),
      paused: isPaused(db),
      retentionDays: retentionDays(db),
    };
    return NextResponse.json(dto);
  } catch (err) {
    return errorResponse(err);
  }
}
