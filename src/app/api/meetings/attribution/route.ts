import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getContainer } from "@/domain/containers";
import { meetingTimeByContainer, unattributedMeetings } from "@/domain/meetings/attribution";
import { errorResponse } from "@/lib/api";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Where meeting time went over a window, and what is not accounted for.
 *
 * The names are joined on here rather than left to the client: the caller wants a ranked list to
 * read, and a list of container ids is not that. A container that has since been deleted is
 * dropped rather than shown as a blank row.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    const from = DateString.safeParse(sp.get("from"));
    const to = DateString.safeParse(sp.get("to"));
    if (!from.success || !to.success) {
      return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
    }
    const db = getDb();
    const range = { from: from.data, to: to.data };

    const byContainer = meetingTimeByContainer(db, range).flatMap((row) => {
      const container = getContainer(db, row.containerId);
      return container ? [{ ...row, name: container.name, kind: container.kind, slug: container.slug }] : [];
    });
    const loose = unattributedMeetings(db, range);

    return NextResponse.json({
      from: range.from,
      to: range.to,
      byContainer,
      unattributed: { meetings: loose.length, minutes: loose.reduce((n, m) => n + m.minutes, 0), items: loose.slice(0, 20) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
