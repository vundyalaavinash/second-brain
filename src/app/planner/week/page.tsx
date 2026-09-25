import { getDb } from "@/db/client";
import { todayLocal } from "@/components/activity/format";
import { PlannerShell } from "@/components/planner/planner-shell";
import { plannerWeek } from "@/lib/planner";
import { DateString } from "@/lib/validation";
import { weekStart } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function PlannerWeekPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  const today = todayLocal();
  const parsed = DateString.safeParse(start);
  const shown = weekStart(parsed.success ? parsed.data : today);
  return <PlannerShell key={shown} view="week" today={today} initial={plannerWeek(getDb(), shown)} />;
}
