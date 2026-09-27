import { getDb } from "@/db/client";
import { RESOURCE_CATEGORIES } from "@/db/enums";
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "@/lib/api";
import { ContainerCard } from "@/components/tasks/container-card";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader, SectionHeading, EmptyState } from "@/components/ui";
import { KIND_ICON } from "@/components/type-icon";
import { titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ResourcesPage() {
  const db = getDb();
  const resources = serializeContainers(db, listContainers(db, { kind: "resource", status: "active" }));
  const groups = RESOURCE_CATEGORIES.map((cat) => ({ cat, list: resources.filter((r) => (r.category ?? "other") === cat) })).filter((g) => g.list.length > 0);
  const now = new Date().getTime();
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Resources"
        meta={
          <>
            <span>Topics of interest.</span> <span className="font-mono">{resources.length}</span> active
          </>
        }
      />
      <NewContainerForm kind="resource" />
      {groups.length === 0 ? (
        <EmptyState icon={KIND_ICON.resource} text="No resources yet. A resource is a topic you keep collecting on." />
      ) : (
        groups.map((g) => (
          <section key={g.cat} className="flex flex-col gap-2">
            <SectionHeading count={g.list.length}>{titleCase(g.cat)}</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-4">
              {g.list.map((r) => (
                <ContainerCard key={r.id} container={r} now={now} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
