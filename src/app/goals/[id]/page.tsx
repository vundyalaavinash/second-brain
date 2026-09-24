import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { goalsWithMeasure, recentCloses } from "@/domain/goals";
import { containerProgress } from "@/domain/tasks";
import { serializeGoal } from "@/lib/api";
import type { GoalDetailDTO } from "@/lib/dto";
import { GoalPage } from "@/components/goals/goal-page";

export const dynamic = "force-dynamic";

/** How many of a goal's most recently closed tasks its detail page carries — matches the API route. */
const RECENT_CLOSES = 10;

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  const today = localDay(new Date().toISOString());
  const [goal] = goalsWithMeasure(db, { id: n }, today);
  if (!goal) notFound();
  const progress = containerProgress(db, goal.containers.map((c) => c.id));
  const detail: GoalDetailDTO = {
    ...serializeGoal(goal),
    links: goal.containers.map((container) => ({ container, progress: progress.get(container.id)! })),
    recentCloses: recentCloses(db, n, RECENT_CLOSES),
  };
  return <GoalPage key={detail.id} initial={detail} today={today} />;
}
