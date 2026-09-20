import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { serializeContainers } from "@/lib/api";
import { todayLocal } from "@/components/activity/format";
import { daysBetween, sortProjects } from "@/lib/deadline";
import { ProjectCard } from "@/components/tasks/project-card";
import { NewContainerForm } from "@/components/new-container-form";
import { PageHeader, EmptyState } from "@/components/ui";
import { KIND_ICON } from "@/components/type-icon";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const db = getDb();
  const today = todayLocal();
  const projects = sortProjects(serializeContainers(db, listContainers(db, { kind: "project", status: "active" })), today);
  const dueThisWeek = projects.filter((p) => {
    if (!p.deadline) return false;
    const days = daysBetween(today, p.deadline);
    return days >= 0 && days <= 7;
  }).length;
  return (
    <div className="w-full max-w-5xl mx-auto px-6 pt-8 flex flex-col gap-5">
      <PageHeader
        title="Projects"
        meta={
          <>
            <span className="font-mono">{projects.length}</span> active, <span className="font-mono">{dueThisWeek}</span> due this week
          </>
        }
      />
      <NewContainerForm kind="project" />
      {projects.length === 0 ? (
        <EmptyState icon={KIND_ICON.project} text="No projects yet. A project is an outcome with a deadline." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}
