import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deletePerson, getPerson, getPersonTimeline, updatePerson } from "@/domain/people";
import { errorResponse, parseId, serializeItem, serializePerson } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  profile: z.string().optional(),
  organization: z.string().optional(),
  team: z.string().optional(),
  title: z.string().optional(),
});

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    const db = getDb();
    const person = getPerson(db, id);
    if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const timeline = getPersonTimeline(db, id, includeArchived);
    return NextResponse.json({
      person: serializePerson(person, getPersonTimeline(db, id).length),
      timeline: timeline.map((i) => serializeItem(db, i)),
    });
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
    const p = updatePerson(db, id, parsed.data);
    return NextResponse.json(serializePerson(p, getPersonTimeline(db, id).length));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    deletePerson(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
