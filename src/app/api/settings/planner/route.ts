import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api";
import { getWorkHours, setWorkHours } from "@/lib/work-hours";

export const dynamic = "force-dynamic";
const Body = z.object({ workHours: z.string().max(11) }).strict();

/** The working hours capacity is measured against. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({ workHours: getWorkHours(getDb()) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json({ workHours: setWorkHours(getDb(), parsed.data.workHours) });
  } catch (err) {
    return errorResponse(err);
  }
}
