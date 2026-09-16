import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recategorise, reorderRules } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ ids: z.array(z.number().int().positive()) });

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const rules = reorderRules(db, parsed.data.ids);
    recategorise(db, 30);
    return NextResponse.json(rules);
  } catch (err) {
    return errorResponse(err);
  }
}
