import { getDb } from "@/db/client";
import { RESOURCE_CATEGORIES } from "@/db/enums";
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader, SectionHeading } from "@/components/ui";
import { titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ResourcesPage() {
  const db = getDb();
  const resources = serializeContainers(db, listContainers(db, { kind: "resource", status: "active" }));
  const groups = RESOURCE_CATEGORIES.map((cat) => ({ cat, list: resources.filter((r) => (r.category ?? "other") === cat) })).filter((g) => g.list.length > 0);
  return (
    <div className="w-full max-w-4xl mx-auto px-6 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Resources"
        meta={
          <>
            <span>Topics of interest.</span> <span className="font-mono">{resources.length}</span> active
          </>
        }
      />
      <NewContainerForm kind="resource" />
      {groups.length === 0 && (
        <ContainerList containers={[]} kind="resource" emptyText="No resources yet. A resource is a topic you keep collecting on." />
      )}
      {groups.map((g) => (
        <section key={g.cat} className="flex flex-col gap-2">
          <SectionHeading count={g.list.length}>{titleCase(g.cat)}</SectionHeading>
          <ContainerList containers={g.list} kind="resource" emptyText="" />
        </section>
      ))}
    </div>
  );
}
