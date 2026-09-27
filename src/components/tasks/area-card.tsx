import Link from "next/link";
import { Link2, Square } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { sinceLabel } from "../activity/format";
import { Chip } from "../ui";

const STALE_DAYS = 14;
const FRESH_DAYS = 3;

/** An area never finishes, so a percent-done ring is the wrong metaphor for it -- what actually
 * matters is whether it's still getting attention. Three bands, not a gradient: fresh (touched
 * in the last few days), ordinary (touched recently enough not to worry about), stale (it's been
 * long enough that it's worth a look). */
function freshness(updatedAt: string, now: number): { label: string; dot: string } {
  const days = (now - Date.parse(updatedAt)) / 86_400_000;
  if (days > STALE_DAYS) return { label: `Stale for ${Math.round(days)} days`, dot: "bg-warn" };
  const label = `Touched ${sinceLabel(updatedAt, now)}`;
  return days <= FRESH_DAYS ? { label, dot: "bg-success" } : { label, dot: "bg-fg-faint" };
}

/**
 * An area's own card. The design brief for an area is "something you maintain rather than
 * finish" (empty-state copy), so this leads with the one thing that's actually true of upkeep --
 * how recently it was touched -- and with the standard it's held to, not a ring that implies a
 * finish line it doesn't have.
 */
export function AreaCard({ area, now }: { area: ContainerDTO; now: number }) {
  const p = area.progress;
  const fresh = freshness(area.updatedAt, now);
  const standard = area.standard || area.goal || area.description;
  return (
    <Link
      href={`/c/${area.slug}`}
      className="focus-ring pane flex flex-col gap-3 p-5 transition-all duration-150 hover:border-hairline-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${fresh.dot}`} aria-hidden />
        <span className="text-[12px] text-fg-faint">{fresh.label}</span>
        <span className="flex-1" />
        {p.total > 0 && (
          <span className="font-mono text-[11px] text-fg-faint">
            {p.open} open · {p.percent}%
          </span>
        )}
      </div>
      <div className="text-[15px] font-medium leading-5 line-clamp-2">{area.name}</div>
      {standard && (
        <blockquote className="m-0 border-l-2 border-violet-dim pl-3 text-[13px] text-fg-muted leading-5 line-clamp-2 italic">{standard}</blockquote>
      )}
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
      {area.pinnedLinks.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {area.pinnedLinks.map((link) => (
            <Chip key={link.id} as="span" icon={Link2} className="text-[11px]">
              {link.domain}
            </Chip>
          ))}
        </div>
      )}
      <div className="font-mono text-[11px] text-fg-faint">{area.itemCount} item{area.itemCount === 1 ? "" : "s"}</div>
    </Link>
  );
}
