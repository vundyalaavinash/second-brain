import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { removeBlock, updateBlock } from "@/domain/blocks";
import { errorResponse, parseId, serializeBlock } from "@/lib/api";
import { PatchBlockBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Moves or resizes one session. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBlockBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(serializeBlock(updateBlock(getDb(), id, parsed.data)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Takes one session off the timeline; the task stays on the plan. */
export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    removeBlock(getDb(), parseId((await ctx.params).id));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
