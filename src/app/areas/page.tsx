import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function AreasPage() {
  const db = getDb();
  const areas = listContainers(db, { kind: "area", status: "active" }).map((c) => serializeContainer(db, c));
  return (
    <div className="w-full max-w-4xl mx-auto px-6 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Areas"
        meta={
          <>
            <span>Responsibilities with a standard.</span> <span className="font-mono">{areas.length} active</span>
          </>
        }
      />
      <NewContainerForm kind="area" />
      <ContainerList containers={areas} kind="area" emptyText="No areas yet. An area is something you maintain rather than finish." />
    </div>
  );
}
