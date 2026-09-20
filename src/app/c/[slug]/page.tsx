import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getContainerBySlug } from "@/domain/containers";
import { listItems } from "@/domain/items";
import { listTasks } from "@/domain/tasks";
import { serializeContainer, serializeItem, serializeTask } from "@/lib/api";
import { todayLocal } from "@/components/activity/format";
import { ContainerEditor } from "@/components/container-editor";

export const dynamic = "force-dynamic";

export default async function ContainerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const c = getContainerBySlug(db, slug);
  if (!c) notFound();
  const items = listItems(db, { containerId: c.id, includeArchived: c.status === "archived", limit: 500 }).map((i) => serializeItem(db, i));
  const tasks = listTasks(db, { containerId: c.id, status: "all" })
    .filter((t) => t.status !== "dropped")
    .map(serializeTask);
  return <ContainerEditor key={c.id} initial={serializeContainer(db, c)} items={items} tasks={tasks} today={todayLocal()} />;
}
