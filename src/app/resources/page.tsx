import { getDb } from "@/db/client";
import { RESOURCE_CATEGORIES } from "@/db/enums";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";

export const dynamic = "force-dynamic";

export default function ResourcesPage() {
  const db = getDb();
  const resources = listContainers(db, { kind: "resource", status: "active" }).map((c) => serializeContainer(db, c));
  const groups = RESOURCE_CATEGORIES.map((cat) => ({ cat, list: resources.filter((r) => (r.category ?? "other") === cat) })).filter((g) => g.list.length > 0);
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Resources</h1>
        <span className="font-mono text-[10px] text-fg-faint">topics of interest · {resources.length} active</span>
      </header>
      <NewContainerForm kind="resource" />
      {groups.length === 0 && <ContainerList containers={[]} emptyText="No resources yet. A resource is a topic you keep collecting on." />}
      {groups.map((g) => (
        <section key={g.cat} className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">{g.cat}</h2>
          <ContainerList containers={g.list} emptyText="" />
        </section>
      ))}
    </div>
  );
}
