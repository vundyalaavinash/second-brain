import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calendarEvents, meetingSeriesDecisions, type MeetingDecision, type MeetingStatus } from "@/db/schema";
import { MeetingError } from "./errors";

/**
 * The decision that actually governs a meeting, in the order a person would expect: their own
 * override on this occurrence, then a standing answer for the whole series, then whatever the
 * calendar's own RSVP status implies. `"tentative"` never becomes `"maybe"` here — `maybe` is a
 * decision a person makes in this app, carrying its own capacity arithmetic, never an inference
 * dressed as a fact.
 */
export function effectiveDecision(
  event: { status: MeetingStatus; decision: MeetingDecision | null },
  seriesDecision: MeetingDecision | null,
): MeetingDecision {
  if (event.decision) return event.decision;
  if (seriesDecision) return seriesDecision;
  return event.status === "declined" ? "not-going" : "going";
}

/**
 * Records a person's decision, either on one occurrence (`calendarEvents.decision`) or on every
 * occurrence of its series (`meetingSeriesDecisions`, keyed by `seriesId`). A series-scoped write
 * with no `seriesId` on the event has no series to apply to and is refused rather than silently
 * becoming an occurrence write it was never asked to be.
 */
export function setMeetingDecision(
  db: DB,
  eventId: number,
  patch: { decision: MeetingDecision; note?: string; scope: "occurrence" | "series" },
): void {
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!ev) throw new MeetingError("Meeting not found", 404);
  const note = patch.note ?? "";
  if (patch.scope === "series") {
    if (!ev.seriesId) throw new MeetingError("This meeting has no series to apply a decision to", 400);
    const values = { seriesId: ev.seriesId, decision: patch.decision, note, decidedAt: new Date().toISOString() };
    db.insert(meetingSeriesDecisions).values(values).onConflictDoUpdate({ target: meetingSeriesDecisions.seriesId, set: values }).run();
    return;
  }
  db.update(calendarEvents).set({ decision: patch.decision, decisionNote: note }).where(eq(calendarEvents.id, eventId)).run();
}

/**
 * Every series decision among `seriesIds`, in one grouped query rather than one per id — the
 * same batching `focusMinutesByTask` and `goalRefsByContainer` already established for their own
 * lists. `seriesId` is the text value `replaceCalendarEvents` already writes into
 * `CalendarEventInput` (`eventkit:{calendarItemIdentifier}` or `feed:{uid}`), not a numeric id.
 */
export function seriesDecisionsFor(db: DB, seriesIds: string[]): Map<string, MeetingDecision> {
  const out = new Map<string, MeetingDecision>();
  const ids = [...new Set(seriesIds)];
  if (ids.length === 0) return out;
  const rows = db
    .select({ seriesId: meetingSeriesDecisions.seriesId, decision: meetingSeriesDecisions.decision })
    .from(meetingSeriesDecisions)
    .where(inArray(meetingSeriesDecisions.seriesId, ids))
    .all();
  for (const row of rows) out.set(row.seriesId, row.decision);
  return out;
}
