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
 *
 * A series write also clears the occurrence override on the row it was issued from — the one the
 * person was actually looking at when they chose "every time" — because `effectiveDecision` ranks
 * an occurrence override above its series' decision, so leaving a stale one in place would make
 * "Not going → Every time" visibly do nothing to the very row that prompted it. This never touches
 * any *other* occurrence's own override: those are separate decisions the person made on purpose.
 *
 * `patch.note` is only ever applied when the caller actually sent one — an omitted `note` leaves
 * whatever is already stored alone rather than blanking it, so a future caller that only ever
 * sends `{ decision }` cannot silently wipe a note nobody asked to touch.
 */
export function setMeetingDecision(
  db: DB,
  eventId: number,
  patch: { decision: MeetingDecision; note?: string; scope: "occurrence" | "series" },
): void {
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!ev) throw new MeetingError("Meeting not found", 404);
  if (patch.scope === "series") {
    if (!ev.seriesId) throw new MeetingError("This meeting has no series to apply a decision to", 400);
    const existing = db.select().from(meetingSeriesDecisions).where(eq(meetingSeriesDecisions.seriesId, ev.seriesId)).get();
    const note = patch.note ?? existing?.note ?? "";
    const values = { seriesId: ev.seriesId, decision: patch.decision, note, decidedAt: new Date().toISOString() };
    db.insert(meetingSeriesDecisions).values(values).onConflictDoUpdate({ target: meetingSeriesDecisions.seriesId, set: values }).run();
    db.update(calendarEvents).set({ decision: null, decisionNote: "" }).where(eq(calendarEvents.id, eventId)).run();
    return;
  }
  const set: { decision: MeetingDecision; decisionNote?: string } = { decision: patch.decision };
  if (patch.note !== undefined) set.decisionNote = patch.note;
  db.update(calendarEvents).set(set).where(eq(calendarEvents.id, eventId)).run();
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
