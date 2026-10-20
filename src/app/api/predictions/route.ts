import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { PREDICTION_KINDS } from "@/db/enums";
import { createPrediction } from "@/domain/predictions";
import { crossSite, errorResponse, forbidden, serializePrediction } from "@/lib/api";
import { predictionsPayload } from "@/lib/predictions";
import { CreatePredictionBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ListParams = z.object({
  kind: z.enum(PREDICTION_KINDS).optional(),
  state: z.enum(["open", "resolved", "all"]).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const blank = (key: string) => {
      const raw = params.get(key);
      return raw === null || raw === "" ? undefined : raw;
    };
    const parsed = ListParams.safeParse({ kind: blank("kind"), state: blank("state") });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(predictionsPayload(getDb(), parsed.data, new Date()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    // A body that is not JSON at all reads as null rather than throwing here, so it fails the
    // schema the same way any other bad body does instead of leaking a raw SyntaxError as a 500.
    const body = CreatePredictionBody.parse(await req.json().catch(() => null));
    return NextResponse.json(serializePrediction(createPrediction(getDb(), body)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
