import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { addBlock } from "@/domain/blocks";
import { errorResponse, serializeBlock } from "@/lib/api";
import { BlockBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Puts one session on the timeline. */
export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = BlockBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(serializeBlock(addBlock(getDb(), parsed.data)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
