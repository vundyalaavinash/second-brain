import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "@/lib/api";
import { ContainerList } from "@/components/container-list";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const db = getDb();
  const projects = serializeContainers(db, listContainers(db, { kind: "project", status: "active" }));
  return (
    <div className="w-full max-w-4xl mx-auto px-6 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Projects"
        meta={
          <>
            <span>Outcomes with a deadline.</span> <span className="font-mono">{projects.length}</span> active
          </>
        }
      />
      <NewContainerForm kind="project" />
      <ContainerList containers={projects} kind="project" emptyText="No projects yet. A project is an outcome with a deadline." />
    </div>
  );
}
