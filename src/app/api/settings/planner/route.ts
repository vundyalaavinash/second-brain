import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type DB } from "@/db/client";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { getWorkHours, setWorkHours, getWorkingDays, setWorkingDays, assertValidWorkHours, assertValidWorkingDays } from "@/lib/work-hours";

export const dynamic = "force-dynamic";
// Both fields are optional so a patch can move either without the view holding the other —
// the same partial-patch shape `FocusSettingsBody` uses. The `workingDays` cap is generous
// rather than 7 on purpose: the domain checks each day's *value* (1-7) and `setWorkingDays`
// dedupes, so a tight cap would reject a list — eight repeats of one day, say — that shrinks to
// a perfectly good one. It is capped at all so an unbounded array never reaches the parser.
const Body = z.object({ workHours: z.string().max(11).optional(), workingDays: z.array(z.number()).max(64).optional() }).strict();

function settings(db: DB) {
  return { workHours: getWorkHours(db), workingDays: getWorkingDays(db) };
}

/** The working hours and working days capacity is measured against. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(settings(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** A saved default is still a write: gated on `crossSite` like every other settings PATCH now
 * is — the focus slice's review noted this route's own PATCH as a pre-existing gap. */
export async function PATCH(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    // Validate every field the patch carries before writing any of them: a patch with a good
    // `workHours` and a bad `workingDays` must answer 400 with neither saved, not `workHours`
    // already landed and `workingDays` rejected (honest-forecast review F2).
    if (parsed.data.workHours !== undefined) assertValidWorkHours(parsed.data.workHours);
    if (parsed.data.workingDays !== undefined) assertValidWorkingDays(parsed.data.workingDays);
    const db = getDb();
    if (parsed.data.workHours !== undefined) setWorkHours(db, parsed.data.workHours);
    if (parsed.data.workingDays !== undefined) setWorkingDays(db, parsed.data.workingDays);
    return NextResponse.json(settings(db));
  } catch (err) {
    return errorResponse(err);
  }
}
