import { getDb } from "@/db/client";
import { addDays } from "@/domain/activity";
import { todayLocal } from "@/components/activity/format";
import { PlannerShell } from "@/components/planner/planner-shell";
import { plannerCalendar, plannerMeetings } from "@/lib/planner";

export const dynamic = "force-dynamic";

/** The window the spec names: thirty days behind, sixty ahead. `to` is exclusive. */
const PAST_DAYS = 30;
const AHEAD_DAYS = 60;
/** Effectively unbounded, for a `?container=` filter only: the project page's "See all in
 * Planner" link promises every meeting filed there, not just the ones that also happen to land
 * in the normal 90-day window -- narrowing to a container already narrows the list plenty
 * (review F2: a meeting filed outside the usual window must not silently vanish behind a link
 * that says "all"). `MeetingsView` still does the actual per-container filtering client-side;
 * this only widens what it has to filter from. */
const ALL_TIME_FROM = "0001-01-01";
const ALL_TIME_TO = "9999-12-31";

export default async function PlannerMeetingsPage({ searchParams }: { searchParams: Promise<{ container?: string }> }) {
  const { container } = await searchParams;
  const db = getDb();
  const today = todayLocal();
  const filtered = container !== undefined && /^\d+$/.test(container);
  const from = filtered ? ALL_TIME_FROM : addDays(today, -PAST_DAYS);
  const to = filtered ? ALL_TIME_TO : addDays(today, AHEAD_DAYS + 1);
  return <PlannerShell view="meetings" today={today} initial={{ from, to, meetings: plannerMeetings(db, { from, to }), calendar: plannerCalendar(db) }} />;
}
