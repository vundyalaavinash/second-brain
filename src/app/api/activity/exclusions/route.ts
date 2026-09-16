import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addExclusion, listExclusions } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["app", "domain"]), pattern: z.string().min(1) });

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listExclusions(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const exclusion = addExclusion(getDb(), parsed.data);
    return NextResponse.json(exclusion, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
