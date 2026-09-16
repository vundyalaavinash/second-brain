import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { replaceCalendarEvents } from "@/domain/activity";
import { requireHelperToken } from "@/lib/activity-auth";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp");
const Body = z.object({
  events: z.array(
    z.object({
      externalId: z.string().min(1),
      title: z.string(),
      startsAt: Iso,
      endsAt: Iso,
      attendees: z.number().int().nonnegative().default(0),
      hasCallLink: z.boolean().default(false),
    }),
  ),
});

export async function POST(req: Request): Promise<Response> {
  const denied = requireHelperToken(req);
  if (denied) return denied;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(replaceCalendarEvents(getDb(), parsed.data.events));
  } catch (err) {
    return errorResponse(err);
  }
}
