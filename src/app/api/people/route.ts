import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createPerson, listPeople } from "@/domain/people";
import { errorResponse, serializePerson } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1),
  profile: z.string().optional(),
  organization: z.string().optional(),
  team: z.string().optional(),
  title: z.string().optional(),
});

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listPeople(getDb()).map((p) => serializePerson(p)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const p = createPerson(getDb(), parsed.data);
    return NextResponse.json(serializePerson(p, 0), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
