import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getItem, mergeItemMeta, parseMeta } from "@/domain/items";
import type { Distillation } from "@/domain/distill";
import { errorResponse, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ status: z.enum(["kept", "dismissed"]) });

/**
 * Records the person's own keep/dismiss decision on a pending distillation -- never a message
 * the sweep re-reads, since a distillation is never re-offered once it carries any status other
 * than "pending" (design §6). 404 both when the item itself doesn't exist and when it exists but
 * has nothing pending to decide on, the same "not found" either way `getItem`'s other callers in
 * this route family already give a missing id.
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const item = getItem(db, id);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = parseMeta<{ distillation?: Distillation }>(item).distillation;
    if (!existing) return NextResponse.json({ error: "No distillation to decide on" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    mergeItemMeta(db, id, { distillation: { ...existing, status: parsed.data.status } });
    return NextResponse.json(serializeItem(db, getItem(db, id)!));
  } catch (err) {
    return errorResponse(err);
  }
}
