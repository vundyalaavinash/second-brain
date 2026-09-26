import { getDb } from "@/db/client";
import { addDays, retentionDays } from "@/domain/activity";
import { auditSeries, nextOccurrenceIds, weeklyMeetingShare } from "@/domain/meetings/audit";
import { todayLocal } from "@/components/activity/format";
import { weekStart } from "@/lib/week";
import { AuditView, type AuditRow } from "@/components/meeting/audit-view";

export const dynamic = "force-dynamic";

/** Design §7: "the last ninety days of meetings" — but never wider than the person's own
 * configurable retention setting (`retentionDays`, 1-3650 days, default 90): `pruneActivity`
 * deletes `calendarEvents` past that window every night, so a retention set below ninety would
 * otherwise leave this page claiming to cover data that no longer exists. */
const WINDOW_DAYS = 90;

/**
 * Fully server-rendered: the only interaction on this page is the one "Not going" control, which
 * writes through the existing `PATCH /api/meetings/[id]/decision` (Task 2) and then asks the
 * router to refresh this same server render -- there is no payload here a client needs to
 * re-fetch on its own, so no `/api/meetings/audit` route was built (per the brief's own note).
 */
export default function MeetingsAuditPage() {
  const db = getDb();
  const now = new Date();
  const today = todayLocal(now);
  // The shorter of the two: a retention setting below the default must narrow the window the
  // page actually reads and names, never just the one it names.
  const windowDays = Math.min(WINDOW_DAYS, retentionDays(db));
  const since = addDays(today, -windowDays);

  const audits = auditSeries(db, { since, now });
  const seriesIds = audits.map((a) => a.seriesId).filter((id): id is string => id !== null);
  const nextIds = nextOccurrenceIds(db, seriesIds, now);
  const rows: AuditRow[] = audits.map((a) => ({ ...a, nextEventId: a.seriesId ? (nextIds.get(a.seriesId) ?? null) : null }));

  const share = weeklyMeetingShare(db, weekStart(today));

  return <AuditView rows={rows} share={share} windowDays={windowDays} />;
}
