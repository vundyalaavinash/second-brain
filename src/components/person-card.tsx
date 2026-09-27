import Link from "next/link";
import type { PersonDTO } from "@/lib/dto";
import { sinceLabel } from "./activity/format";
import { count } from "./planner/open-meeting";

/**
 * A person's own card: no ring, because nobody has a percent done -- the two things worth
 * leading with instead are how recently anything was linked to them and, when there is one, how
 * often they show up in a meeting. A zero meeting count reads as a fact about most people in here
 * (most links are notes, not meetings), so it drops off the card entirely rather than sitting
 * there as a nudge.
 */
export function PersonCard({ person, now }: { person: PersonDTO; now: number }) {
  return (
    <Link
      href={`/people/${person.slug}`}
      className="focus-ring pane flex flex-col gap-3 p-5 transition-all duration-150 hover:border-hairline-strong motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-9 h-9 rounded-full bg-layer-2 text-[13px] font-medium flex items-center justify-center shrink-0">
          {person.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-5 truncate">{person.name}</div>
          <div className="font-mono text-[11px] text-fg-faint truncate">@{person.slug}</div>
        </div>
      </div>
      <div className="border-t border-hairline pt-3 flex flex-col gap-1 text-[13px] min-w-0">
        {person.lastContact ? (
          <span className="text-fg-muted">Last contact {sinceLabel(person.lastContact, now)}</span>
        ) : (
          <span className="text-fg-faint">Nothing linked yet</span>
        )}
        {person.meetingCount > 0 && <span className="text-[12px] text-fg-faint">{count(person.meetingCount, "meeting")} together</span>}
      </div>
      <div className="font-mono text-[11px] text-fg-faint">{person.itemCount} item{person.itemCount === 1 ? "" : "s"}</div>
    </Link>
  );
}
