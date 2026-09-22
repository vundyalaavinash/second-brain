import { getDb } from "@/db/client";
import { addDays } from "@/domain/activity";
import { todayLocal } from "@/components/activity/format";
import { PlannerShell } from "@/components/planner/planner-shell";
import { plannerCalendar, plannerMeetings } from "@/lib/planner";

export const dynamic = "force-dynamic";

/** The window the spec names: thirty days behind, sixty ahead. `to` is exclusive. */
const PAST_DAYS = 30;
const AHEAD_DAYS = 60;

export default function PlannerMeetingsPage() {
  const db = getDb();
  const today = todayLocal();
  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, AHEAD_DAYS + 1);
  return <PlannerShell view="meetings" today={today} initial={{ from, to, meetings: plannerMeetings(db, { from, to }), calendar: plannerCalendar(db) }} />;
}
