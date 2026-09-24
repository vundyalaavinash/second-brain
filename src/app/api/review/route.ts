import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { saveReviewStep } from "@/domain/review";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { reviewPayload } from "@/lib/review";
import { DateString, SaveReviewBody } from "@/lib/validation";
import { weekStart } from "@/lib/week";

export const dynamic = "force-dynamic";

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** The week a bare `?week=` names — the Monday it falls in, not necessarily the day itself, so a
 * link built off any day of the week lands on the same review. No param at all means the week
 * the app is being used in right now. `undefined` marks a param that failed to parse at all. */
function resolveWeek(raw: string | null): string | undefined {
  if (raw === null || raw === "") return weekStart(localDay(new Date().toISOString()));
  const parsed = DateString.safeParse(raw);
  return parsed.success ? weekStart(parsed.data) : undefined;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const week = resolveWeek(new URL(req.url).searchParams.get("week"));
    if (week === undefined) return badRequest("week must be YYYY-MM-DD");
    const db = getDb();
    return NextResponse.json(reviewPayload(db, week, new Date()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    // Parsed straight through zod: errorResponse maps a ZodError to 400, so a bad body never
    // reads as a 500. A body that is not JSON at all reads as null instead of throwing here, so
    // it fails the same schema check rather than leaking the parser's own SyntaxError.
    const body = SaveReviewBody.parse(await req.json().catch(() => null));
    const db = getDb();
    saveReviewStep(db, body.week, body.step, body.value);
    return NextResponse.json(reviewPayload(db, body.week, new Date()));
  } catch (err) {
    return errorResponse(err);
  }
}
