import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { deleteContainer, getContainer, updateContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";
import { PatchContainerBody as PatchBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const c = getContainer(db, id);
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(serializeContainer(db, c));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(serializeContainer(db, updateContainer(db, id, parsed.data)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    deleteContainer(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
