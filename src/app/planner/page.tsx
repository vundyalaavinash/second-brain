import { getDb } from "@/db/client";
import { todayLocal } from "@/components/activity/format";
import { PlannerShell } from "@/components/planner/planner-shell";
import { plannerDay } from "@/lib/planner";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function PlannerDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const today = todayLocal();
  const parsed = DateString.safeParse(date);
  const shown = parsed.success ? parsed.data : today;
  // Keyed by the day: arriving at another date replaces the shell rather than leaving the
  // previous day's payload in its state.
  return <PlannerShell key={shown} view="day" today={today} initial={plannerDay(getDb(), shown)} />;
}
