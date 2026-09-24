import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { saveReviewStep, type ReviewSnapshot } from "@/domain/review";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { reviewPayload } from "@/lib/review";
import { CalendarDateString, SaveReviewBody } from "@/lib/validation";
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
  const parsed = CalendarDateString.safeParse(raw);
  return parsed.success ? weekStart(parsed.data) : undefined;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const week = resolveWeek(new URL(req.url).searchParams.get("week"));
    if (week === undefined) return badRequest("week must be a real YYYY-MM-DD date");
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
    // Design §5.1: exactly one review item per week. The client always sends a Monday, but the
    // route is the guard — a mid-week date here would open a second item that `GET` (which does
    // normalize) could never read back.
    const week = weekStart(body.week);
    const db = getDb();
    // §5.2's snapshot, frozen at the moment of *this* save: the figures a review's own item
    // carries are read off the domains that own them (never off the review item itself, which
    // holds only the answers and this snapshot), so computing it before the write below is safe
    // — nothing `saveReviewStep` touches can change what these figures are.
    const before = reviewPayload(db, week, new Date());
    const snapshot: ReviewSnapshot = {
      done: before.back.done,
      dropped: before.back.dropped,
      slipped: before.back.slipped,
      focusMinutes: before.back.focusMinutes,
      focusRuns: before.back.focusRuns,
      meetings: before.back.meetings,
      projects: before.back.projects.map((p) => ({ containerId: p.container.id, name: p.container.name, closed: p.closed, percent: p.percent })),
    };
    saveReviewStep(db, week, body.step, body.value, snapshot);
    return NextResponse.json(reviewPayload(db, week, new Date()));
  } catch (err) {
    return errorResponse(err);
  }
}
