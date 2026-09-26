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

/** `?container=<id>` -> a validated id, or `null` for anything else (absent, `0`, a decimal, a
 * leading zero, garbage) -- resolved once, here, rather than re-parsed by the client with its
 * own, easily-diverging rule (review N1: the two disagreed on `0` and on non-canonical digit
 * strings). A malformed value falls back to "no filter" rather than a page-breaking 400: this is
 * a page a person can navigate to by hand, not an API route. */
function parseContainerId(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export default async function PlannerMeetingsPage({ searchParams }: { searchParams: Promise<{ container?: string }> }) {
  const { container } = await searchParams;
  const db = getDb();
  const today = todayLocal();
  const containerId = parseContainerId(container);
  const from = containerId !== null ? ALL_TIME_FROM : addDays(today, -PAST_DAYS);
  const to = containerId !== null ? ALL_TIME_TO : addDays(today, AHEAD_DAYS + 1);
  return (
    <PlannerShell view="meetings" today={today} initial={{ from, to, meetings: plannerMeetings(db, { from, to }), calendar: plannerCalendar(db), containerId }} />
  );
}
