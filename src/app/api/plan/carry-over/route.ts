import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { carryOver } from "@/domain/plan";
import { errorResponse } from "@/lib/api";
import { CarryOverBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = CarryOverBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json({ moved: carryOver(getDb(), parsed.data.from, parsed.data.to) });
  } catch (err) {
    return errorResponse(err);
  }
}
