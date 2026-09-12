import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteItem, getItem } from "@/domain/items";
import { updateItemContent } from "@/domain/items/capture";
import { errorResponse, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const item = getItem(db, id);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(serializeItem(db, item));
  } catch (err) {
    return errorResponse(err);
  }
}

const PatchBody = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const item = updateItemContent(db, id, parsed.data);
    return NextResponse.json(serializeItem(db, item));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    if (!getItem(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    deleteItem(db, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
