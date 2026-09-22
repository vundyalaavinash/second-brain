import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordHelperSeen, replaceCalendarEvents } from "@/domain/activity";
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
      organizer: z.string().default(""),
      attendeeNames: z.array(z.string()).max(10).default([]),
      location: z.string().default(""),
      joinUrl: z.string().url().nullable().default(null),
      notes: z.string().max(4000).default(""),
      allDay: z.boolean().default(false),
      status: z.enum(["accepted", "tentative", "declined", "none"]).default("none"),
      calendarTitle: z.string().default(""),
    }),
  ),
  /** How many event calendars the helper can see; absent from older helpers. */
  calendarsSeen: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const denied = requireHelperToken(req);
  if (denied) return denied;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const { events, calendarsSeen } = parsed.data;
    if (calendarsSeen !== undefined) recordHelperSeen(db, new Date().toISOString(), { calendarsSeen });
    return NextResponse.json(replaceCalendarEvents(db, events));
  } catch (err) {
    return errorResponse(err);
  }
}
