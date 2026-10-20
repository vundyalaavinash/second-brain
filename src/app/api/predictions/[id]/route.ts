import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { deletePrediction, resolvePrediction, unresolvePrediction, updatePrediction } from "@/domain/predictions";
import { crossSite, errorResponse, forbidden, parseId, serializePrediction } from "@/lib/api";
import { PatchPredictionBody, ResolvePredictionBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The claim, its date, its notes and its links. Never the stated numbers — see `updatePrediction`. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    const patch = PatchPredictionBody.parse(await req.json().catch(() => null));
    return NextResponse.json(serializePrediction(updatePrediction(getDb(), id, patch)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Writing down what actually happened, which is its own verb rather than a patch: it is the one
 *  edit that changes a score, and the one the whole log is waiting for. */
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    const body = ResolvePredictionBody.parse(await req.json().catch(() => null));
    const db = getDb();
    const row = body.unresolve ? unresolvePrediction(db, id) : resolvePrediction(db, id, body);
    return NextResponse.json(serializePrediction(row));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    deletePrediction(getDb(), parseId((await ctx.params).id));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
