import { getDb } from "@/db/client";
import { getDay } from "@/domain/activity";
import { listTasks } from "@/domain/tasks";
import { serializeTask } from "@/lib/api";
import { todayLocal } from "@/components/activity/format";
import { TodayPage } from "@/components/today/today-page";

export const dynamic = "force-dynamic";

export default function Today() {
  const db = getDb();
  const today = todayLocal();
  const tasks = listTasks(db, { containerId: undefined, status: "open" }).map(serializeTask);
  const day = getDay(db, today);
  return <TodayPage today={today} tasks={tasks} meetings={day.meetings} />;
}
