import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFocusSettings, setFocusSettings } from "@/domain/focus";
import { crossSite, errorResponse, forbidden } from "@/lib/api";
import { FocusSettingsBody } from "@/lib/validation";
import type { FocusSettingsDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

/** The saved defaults for an ad-hoc focus run: how long one runs, and the break rhythm around it. */
export async function GET(): Promise<Response> {
  try {
    const settings: FocusSettingsDTO = getFocusSettings(getDb());
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}

/** A partial patch, so one field can move without the view holding the rest. Gated on `crossSite`
 * unlike the older settings routes this one is modelled on — a saved default is still a write. */
export async function PATCH(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const parsed = FocusSettingsBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const settings: FocusSettingsDTO = setFocusSettings(getDb(), parsed.data);
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}
