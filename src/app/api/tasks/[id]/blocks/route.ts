import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { clearBlocks } from "@/domain/blocks";
import { errorResponse, parseId } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Takes the task's sessions off one day, or off every day when no date is given. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const raw = new URL(req.url).searchParams.get("date");
    if (raw !== null && !DateString.safeParse(raw).success) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    return NextResponse.json({ removed: clearBlocks(getDb(), id, raw ?? undefined) });
  } catch (err) {
    return errorResponse(err);
  }
}
