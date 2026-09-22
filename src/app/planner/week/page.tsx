import { getDb } from "@/db/client";
import { addDays } from "@/domain/activity";
import { todayLocal } from "@/components/activity/format";
import { PlannerShell } from "@/components/planner/planner-shell";
import { plannerWeek } from "@/lib/planner";
import { DateString } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** The Monday on or before the day. Sunday counts as the week's last day, not its first. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return addDays(day, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}

export default async function PlannerWeekPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  const today = todayLocal();
  const parsed = DateString.safeParse(start);
  const shown = mondayOf(parsed.success ? parsed.data : today);
  return <PlannerShell key={shown} view="week" today={today} initial={plannerWeek(getDb(), shown)} />;
}
