import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createRule, listRules, recategorise } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  matchKind: z.enum(["app", "domain", "title_contains"]),
  pattern: z.string().min(1),
  categoryId: z.number().int().positive(),
});

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listRules(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const rule = createRule(db, parsed.data);
    recategorise(db, 30);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
