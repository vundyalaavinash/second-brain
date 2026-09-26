import { getDb } from "@/db/client";
import { addDays } from "@/domain/activity";
import { auditSeries, nextOccurrenceIds, weeklyMeetingShare } from "@/domain/meetings/audit";
import { todayLocal } from "@/components/activity/format";
import { weekStart } from "@/lib/week";
import { AuditView, type AuditRow } from "@/components/meeting/audit-view";

export const dynamic = "force-dynamic";

/** Design §7: "the last ninety days of meetings". */
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
  const since = addDays(today, -WINDOW_DAYS);

  const audits = auditSeries(db, { since, now });
  const seriesIds = audits.map((a) => a.seriesId).filter((id): id is string => id !== null);
  const nextIds = nextOccurrenceIds(db, seriesIds, now);
  const rows: AuditRow[] = audits.map((a) => ({ ...a, nextEventId: a.seriesId ? (nextIds.get(a.seriesId) ?? null) : null }));

  const share = weeklyMeetingShare(db, weekStart(today));

  return <AuditView rows={rows} share={share} />;
}
