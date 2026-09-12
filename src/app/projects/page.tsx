import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainer } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const db = getDb();
  const projects = listContainers(db, { kind: "project", status: "active" }).map((c) => serializeContainer(db, c));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Projects</h1>
        <span className="font-mono text-[10px] text-fg-faint">outcomes with a deadline · {projects.length} active</span>
      </header>
      <NewContainerForm kind="project" />
      <ContainerList containers={projects} emptyText="No projects yet. A project is an outcome with a deadline." />
    </div>
  );
}
