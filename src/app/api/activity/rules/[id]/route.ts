import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteRule, recategorise, updateRule } from "@/domain/activity";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const Body = z
  .object({
    matchKind: z.enum(["app", "domain", "title_contains"]),
    pattern: z.string().min(1),
    categoryId: z.number().int().positive(),
  })
  .partial();

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const rule = updateRule(db, id, parsed.data);
    recategorise(db, 30);
    return NextResponse.json(rule);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    deleteRule(db, id);
    recategorise(db, 30);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
