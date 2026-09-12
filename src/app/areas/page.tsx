import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";

export const dynamic = "force-dynamic";

export default function AreasPage() {
  const db = getDb();
  const areas = listContainers(db, { kind: "area", status: "active" }).map((c) => serializeContainer(db, c));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Areas</h1>
        <span className="font-mono text-[10px] text-fg-faint">responsibilities with a standard · {areas.length} active</span>
      </header>
      <NewContainerForm kind="area" />
      <ContainerList containers={areas} emptyText="No areas yet. An area is something you maintain, not finish." />
    </div>
  );
}
