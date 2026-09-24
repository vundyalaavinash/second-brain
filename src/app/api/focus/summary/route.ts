import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { focusSummary } from "@/domain/focus";
import { errorResponse } from "@/lib/api";
import { DateString } from "@/lib/validation";
import type { FocusSummaryDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

const SummaryParams = z.object({ from: DateString, to: DateString });

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parsed = SummaryParams.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const summary: FocusSummaryDTO = focusSummary(db, parsed.data);
    return NextResponse.json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
