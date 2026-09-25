// `[id]` here is a meeting item id, the same id space `[id]/actions` uses -- not the calendar
// event id the parent `/api/meetings/[id]` route takes.
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getItem } from "@/domain/items";
import { MeetingError } from "@/domain/meetings/errors";
import { releaseAudio } from "@/domain/meetings/audio-retention";
import { crossSite, errorResponse, forbidden, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * "Remove the audio" on the meeting page -- reclaiming a large file now rather than waiting for
 * design §9's window. `releaseAudio` checks the rule that cannot be broken itself, at the moment
 * of deletion, regardless of what the page decided to show a button for: a meeting with no
 * transcript, or only an empty one, answers 409 and the file stays exactly where it was.
 */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const item = getItem(db, id);
    if (!item) throw new MeetingError(`Meeting ${id} not found`, 404);
    if (item.type !== "meeting") throw new MeetingError("Only a meeting has audio to remove", 400);

    const result = releaseAudio(db, id);
    if (!result) {
      throw new MeetingError("This meeting's audio cannot be removed: there is no transcript yet, or it was already removed", 409);
    }
    return NextResponse.json(serializeItem(db, getItem(db, id)!));
  } catch (err) {
    return errorResponse(err);
  }
}
