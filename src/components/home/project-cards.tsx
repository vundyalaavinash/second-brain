import Link from "next/link";
import type { ProjectCardDTO } from "@/lib/dto";
import { daysBetween, TONE_CLASS, type DeadlineTone } from "@/lib/deadline";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Spec §2: a deadline this close is worth a warning colour. */
const WARN_DAYS = 7;

/** "26 Sep": short enough for a card, unambiguous however far off the date is. */
function monthDay(deadline: string): string {
  const [, m, d] = deadline.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Past is danger, inside a week is warn, anything further off is just a date. */
function deadlineTone(deadline: string, today: string): DeadlineTone {
  const days = daysBetween(today, deadline);
  if (days < 0) return "danger";
  return days <= WARN_DAYS ? "warn" : "muted";
}

/** How far through its tasks a project is; a project with none is not started, not finished. */
function percent(open: number, done: number): number {
  const total = open + done;
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function Card({ project, today }: { project: ProjectCardDTO; today: string }) {
  return (
    <li className="pane p-3 flex flex-col gap-1.5 min-w-0 transition-colors duration-150 hover:border-hairline-strong">
      <div className="flex items-baseline gap-2 min-w-0">
        <Link href={`/c/${project.slug}`} className="focus-ring rounded-sm flex-1 min-w-0 truncate text-[13.5px] font-medium hover:text-violet-bright">
          {project.name}
        </Link>
        {project.deadline && (
          <span className={`font-mono text-[11px] shrink-0 ${TONE_CLASS[deadlineTone(project.deadline, today)]}`}>{monthDay(project.deadline)}</span>
        )}
      </div>
      <span className="font-mono text-[11px] text-fg-faint">
        {project.open} open · {percent(project.open, project.done)}%
      </span>
      {project.nextTask ? (
        <span className="text-[12.5px] text-fg-muted truncate">{project.nextTask.title}</span>
      ) : project.open + project.done > 0 ? (
        <span className="text-[12.5px] text-success">All done</span>
      ) : (
        // A project nobody has written a task for is not finished, as `tasks/project-card.tsx` says too.
        <span className="text-[12.5px] text-fg-faint">No open tasks</span>
      )}
    </li>
  );
}

/** The active projects, nearest deadline first, as the payload already ordered them. */
export function ProjectCards({ projects, today }: { projects: ProjectCardDTO[]; today: string }) {
  return (
    <section aria-label="Projects in motion" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="micro">Projects in motion</span>
        <Link href="/projects" className="focus-ring rounded-sm text-[12px] text-fg-muted hover:text-fg transition-colors duration-150">
          All projects
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">No active projects</p>
      ) : (
        <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {projects.map((p) => (
            <Card key={p.id} project={p} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}
