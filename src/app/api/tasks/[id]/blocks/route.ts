import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { clearBlocks } from "@/domain/blocks";
import { errorResponse, parseId } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Takes the task's sessions off one day. The day is required: a missing one must not wipe every day. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = DateString.safeParse(new URL(req.url).searchParams.get("date"));
    if (!parsed.success) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    return NextResponse.json({ removed: clearBlocks(getDb(), id, parsed.data) });
  } catch (err) {
    return errorResponse(err);
  }
}
