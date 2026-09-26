import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getContainerBySlug } from "@/domain/containers";
import { goalRefsByContainer } from "@/domain/goals";
import { listItems } from "@/domain/items";
import { listTasks } from "@/domain/tasks";
import { serializeContainer, serializeItem, serializeTasks } from "@/lib/api";
import { containerMeetings } from "@/lib/planner";
import { todayLocal } from "@/components/activity/format";
import { ContainerEditor } from "@/components/container-editor";

export const dynamic = "force-dynamic";

export default async function ContainerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const c = getContainerBySlug(db, slug);
  if (!c) notFound();
  const rawItems = listItems(db, { containerId: c.id, includeArchived: c.status === "archived", limit: 500 });
  const items = rawItems.map((i) => serializeItem(db, i));
  // Its own section, not the generic bucket the rest of `items` still falls into below — see
  // `MeetingsSection` (Task 3, step 3).
  const meetings = containerMeetings(
    db,
    rawItems.filter((i) => i.type === "meeting"),
  );
  const tasks = serializeTasks(
    db,
    listTasks(db, { containerId: c.id, status: "all" }).filter((t) => t.status !== "dropped"),
  );
  const goals = goalRefsByContainer(db, [c.id]).get(c.id) ?? [];
  return <ContainerEditor key={c.id} initial={serializeContainer(db, c)} items={items} tasks={tasks} meetings={meetings} goals={goals} today={todayLocal()} />;
}
