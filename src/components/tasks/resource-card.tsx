import Link from "next/link";
import { Link2 } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { sinceLabel } from "../activity/format";
import { titleCase } from "@/lib/format";
import { Chip } from "../ui";

/**
 * A resource's own card. A resource is "a topic you keep collecting on" (empty-state copy), not
 * an outcome -- it almost never has tasks, so a progress ring here would read as a stat nobody
 * asked for. What a resource actually accumulates is links, so those lead instead of hiding at
 * the bottom, alongside the category that already sorts it into its own section on the page.
 */
export function ResourceCard({ resource, now }: { resource: ContainerDTO; now: number }) {
  const p = resource.progress;
  const subtitle = resource.goal || resource.description;
  return (
    <Link
      href={`/c/${resource.slug}`}
      className="focus-ring pane flex flex-col gap-3 p-5 transition-all duration-150 hover:border-hairline-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2">
        {resource.category && (
          <Chip as="span" className="text-[11px]">
            {titleCase(resource.category)}
          </Chip>
        )}
        <span className="flex-1" />
        <span className="text-[12px] text-fg-faint">Updated {sinceLabel(resource.updatedAt, now)}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-medium leading-5 line-clamp-2">{resource.name}</div>
        {subtitle && <div className="text-[13px] text-fg-muted leading-5 line-clamp-2 mt-0.5">{subtitle}</div>}
      </div>
      <div className="border-t border-hairline pt-3 flex flex-col gap-2 min-w-0">
        {resource.pinnedLinks.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {resource.pinnedLinks.map((link) => (
              <Chip key={link.id} as="span" icon={Link2} className="text-[11px]">
                {link.domain}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-fg-faint">No links pinned yet</span>
        )}
      </div>
      <div className="font-mono text-[11px] text-fg-faint">
        {p.open > 0 ? `${p.open} open task${p.open === 1 ? "" : "s"}, ` : ""}
        {resource.itemCount} item{resource.itemCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}
