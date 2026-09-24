import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { goalsWithMeasure } from "@/domain/goals";
import { serializeGoal } from "@/lib/api";
import { GoalList } from "@/components/goals/goal-list";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const db = getDb();
  const today = localDay(new Date().toISOString());
  const active = goalsWithMeasure(db, { status: "active" }, today).map(serializeGoal);
  // No single status stands for "closed" (hit, missed, dropped each their own), so the second
  // call reads everything and keeps what an unfiltered goalsWithMeasure already sorts
  // most-recently-decided-first.
  const closed = goalsWithMeasure(db, {}, today)
    .filter((g) => g.status !== "active")
    .map(serializeGoal);
  return <GoalList active={active} closed={closed} today={today} />;
}
