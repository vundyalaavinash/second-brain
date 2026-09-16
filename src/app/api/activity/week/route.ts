import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getWeek, listCategories } from "@/domain/activity";
import { errorResponse } from "@/lib/api";
import type { ActivityWeekDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const start = new URL(req.url).searchParams.get("start") ?? "";
    const db = getDb();
    const dto: ActivityWeekDTO = { ...getWeek(db, start), categories: listCategories(db) };
    return NextResponse.json(dto);
  } catch (err) {
    return errorResponse(err);
  }
}
