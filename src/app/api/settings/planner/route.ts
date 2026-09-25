import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type DB } from "@/db/client";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { getWorkHours, setWorkHours, getWorkingDays, setWorkingDays } from "@/lib/work-hours";

export const dynamic = "force-dynamic";
// Both fields are optional so a patch can move either without the view holding the other —
// the same partial-patch shape `FocusSettingsBody` uses.
const Body = z.object({ workHours: z.string().max(11).optional(), workingDays: z.array(z.number()).max(7).optional() }).strict();

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
    const db = getDb();
    if (parsed.data.workHours !== undefined) setWorkHours(db, parsed.data.workHours);
    if (parsed.data.workingDays !== undefined) setWorkingDays(db, parsed.data.workingDays);
    return NextResponse.json(settings(db));
  } catch (err) {
    return errorResponse(err);
  }
}
