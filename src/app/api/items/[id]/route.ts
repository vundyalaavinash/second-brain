import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { archiveItem, deleteItem, fileItem, getItem, restoreItem } from "@/domain/items";
import { updateItemContent } from "@/domain/items/capture";
import { setItemPeople } from "@/domain/people";
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
  containerId: z.number().int().positive().nullable().optional(),
  archived: z.boolean().optional(),
  people: z.array(z.number().int().positive()).optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { containerId, archived, people: personIds, ...content } = parsed.data;
    const db = getDb();
    if (!getItem(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (content.title !== undefined || content.body !== undefined || content.tags !== undefined) updateItemContent(db, id, content);
    if (containerId !== undefined) fileItem(db, id, containerId);
    if (archived === true) archiveItem(db, id);
    if (archived === false) restoreItem(db, id);
    if (personIds !== undefined) setItemPeople(db, id, personIds);
    return NextResponse.json(serializeItem(db, getItem(db, id)!));
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
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
