import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "@/lib/api";
import { ContainerCard } from "@/components/tasks/container-card";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader, EmptyState } from "@/components/ui";
import { KIND_ICON } from "@/components/type-icon";

export const dynamic = "force-dynamic";

export default function AreasPage() {
  const db = getDb();
  const areas = serializeContainers(db, listContainers(db, { kind: "area", status: "active" }));
  const now = new Date().getTime();
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Areas"
        meta={
          <>
            <span>Responsibilities with a standard.</span> <span className="font-mono">{areas.length}</span> active
          </>
        }
      />
      <NewContainerForm kind="area" />
      {areas.length === 0 ? (
        <EmptyState icon={KIND_ICON.area} text="No areas yet. An area is something you maintain rather than finish." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-4">
          {areas.map((a) => (
            <ContainerCard key={a.id} container={a} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
