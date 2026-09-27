import Link from "next/link";
import { Link2, Square } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { sinceLabel } from "../activity/format";
import { Chip } from "../ui";
import { ProgressRing } from "./progress-ring";

/**
 * The card an area or a resource gets, the same shape as `ProjectCard` -- the ring, the next
 * thing to do, the pinned links, the counts -- minus the one field neither of them has. Both are
 * upkeep rather than an outcome with a deadline (an area is "something you maintain rather than
 * finish", a resource "a topic you keep collecting on"), so the slot that would hold a deadline
 * instead says how recently the container moved.
 */
export function ContainerCard({ container, now }: { container: ContainerDTO; now: number }) {
  const p = container.progress;
  return (
    <Link
      href={`/c/${container.slug}`}
      className="focus-ring pane flex flex-col gap-3 p-5 transition-all duration-150 hover:border-hairline-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        <ProgressRing percent={p.percent} />
        <span className="font-mono text-[12px] text-fg-muted">{p.percent}%</span>
        <span className="flex-1" />
        <span className="text-[12px] text-fg-faint">Updated {sinceLabel(container.updatedAt, now)}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-medium leading-5 line-clamp-2">{container.name}</div>
        {(container.goal || container.standard || container.description) && (
          <div className="text-[13px] text-fg-muted leading-5 line-clamp-2 mt-0.5">{container.goal || container.standard || container.description}</div>
        )}
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
      {container.pinnedLinks.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {container.pinnedLinks.map((link) => (
            <Chip key={link.id} as="span" icon={Link2} className="text-[11px]">
              {link.domain}
            </Chip>
          ))}
        </div>
      )}
      <div className="font-mono text-[11px] text-fg-faint">
        {p.total} task{p.total === 1 ? "" : "s"}, {container.itemCount} item{container.itemCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
