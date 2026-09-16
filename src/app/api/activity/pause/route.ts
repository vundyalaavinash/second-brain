import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { isPaused, retentionDays, setPaused, setRetentionDays } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ paused: z.boolean().optional(), retentionDays: z.number().int().optional() });

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    if (parsed.data.paused !== undefined) setPaused(db, parsed.data.paused);
    if (parsed.data.retentionDays !== undefined) setRetentionDays(db, parsed.data.retentionDays);
    return NextResponse.json({ paused: isPaused(db), retentionDays: retentionDays(db) });
  } catch (err) {
    return errorResponse(err);
  }
}
