import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { localDay } from "@/domain/activity";
import { goalDetail } from "@/lib/api";
import { GoalPage } from "@/components/goals/goal-page";

export const dynamic = "force-dynamic";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  const today = localDay(new Date().toISOString());
  const detail = goalDetail(db, n, today);
  if (!detail) notFound();
  return <GoalPage key={detail.id} initial={detail} today={today} />;
}
