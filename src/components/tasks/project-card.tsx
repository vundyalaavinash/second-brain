import Link from "next/link";
import { Link2, Square } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { deadlineLabel, TONE_CLASS } from "@/lib/deadline";
import { Chip } from "../ui";
import { ProgressRing } from "./progress-ring";

export function ProjectCard({ project, today }: { project: ContainerDTO; today: string }) {
  const p = project.progress;
  const due = deadlineLabel(project.deadline, today);
  return (
    <Link
      href={`/c/${project.slug}`}
      className="focus-ring flex flex-col gap-3 rounded-lg border border-hairline bg-slate p-5 transition-all duration-150 hover:border-hairline-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        <ProgressRing percent={p.percent} />
        <span className="font-mono text-[12px] text-fg-muted">{p.percent}%</span>
        <span className="flex-1" />
        <span className={`text-[12px] ${TONE_CLASS[due.tone]}`}>{due.text}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-medium leading-5 line-clamp-2">{project.name}</div>
        {project.goal && <div className="text-[13px] text-fg-muted leading-5 line-clamp-2 mt-0.5">{project.goal}</div>}
      </div>
      <div className="border-t border-hairline pt-3 flex items-center gap-2 text-[13px] min-w-0">
        {p.nextTask ? (
          <>
            <Square className="w-3.5 h-3.5 text-fg-faint shrink-0" aria-hidden />
            <span className="truncate">{p.nextTask.title}</span>
          </>
        ) : p.total > 0 ? (
          <span className="text-success">All done</span>
        ) : (
          <span className="text-fg-faint">No open tasks</span>
        )}
      </div>
      {project.pinnedLinks.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {project.pinnedLinks.map((link) => (
            <Chip key={link.id} as="span" icon={Link2} className="text-[11px]">
              {link.domain}
            </Chip>
          ))}
        </div>
      )}
      <div className="font-mono text-[11px] text-fg-faint">
        {p.total} task{p.total === 1 ? "" : "s"}, {project.itemCount} item{project.itemCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
