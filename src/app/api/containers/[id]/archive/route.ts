import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { archiveContainer } from "@/domain/containers";
import { errorResponse, parseId, serializeContainer } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ moveItemsTo: z.number().int().positive().nullable().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const raw = await req.text();
    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(serializeContainer(db, archiveContainer(db, id, parsed.data)));
  } catch (err) {
    return errorResponse(err);
  }
}
