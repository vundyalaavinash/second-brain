import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { goalsWithMeasure } from "@/domain/goals";
import { serializeGoal } from "@/lib/api";
import { GoalList } from "@/components/goals/goal-list";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const db = getDb();
  const today = localDay(new Date().toISOString());
  // One unfiltered call: goalsWithMeasure already sorts active goals soonest-due-first and
  // closed ones most-recently-decided-first, so partitioning by status keeps both orders intact
  // without paying for the query twice.
  const goals = goalsWithMeasure(db, {}, today).map(serializeGoal);
  const active = goals.filter((g) => g.status === "active");
  const closed = goals.filter((g) => g.status !== "active");
  return <GoalList active={active} closed={closed} today={today} />;
}
