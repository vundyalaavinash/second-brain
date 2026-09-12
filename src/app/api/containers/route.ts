import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { CONTAINER_KINDS, CONTAINER_STATUSES } from "@/db/enums";
import { createContainer, listContainers } from "@/domain/containers";
import { errorResponse, serializeContainer } from "@/lib/api";
import { CreateContainerBody as CreateBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const c = createContainer(db, parsed.data);
    return NextResponse.json(serializeContainer(db, c), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

const ListParams = z.object({
  kind: z.enum(CONTAINER_KINDS).optional(),
  status: z.enum(CONTAINER_STATUSES).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parsed = ListParams.safeParse({
      kind: url.searchParams.get("kind") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    return NextResponse.json(listContainers(db, parsed.data).map((c) => serializeContainer(db, c)));
  } catch (err) {
    return errorResponse(err);
  }
}
