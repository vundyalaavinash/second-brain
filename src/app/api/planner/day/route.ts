import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api";
import { plannerDay } from "@/lib/planner";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const parsed = DateString.safeParse(new URL(req.url).searchParams.get("date"));
    if (!parsed.success) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    return NextResponse.json(plannerDay(getDb(), parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
