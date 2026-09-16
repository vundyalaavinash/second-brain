import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { updateCategory } from "@/domain/activity";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ name: z.string().min(1).optional(), color: z.string().optional() });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(updateCategory(db, id, parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
