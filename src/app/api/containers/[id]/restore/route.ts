import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { restoreContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    return NextResponse.json(serializeContainer(db, restoreContainer(db, id)));
  } catch (err) {
    return errorResponse(err);
  }
}
