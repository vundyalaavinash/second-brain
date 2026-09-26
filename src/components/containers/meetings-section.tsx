import Link from "next/link";
import type { ContainerMeetingDTO } from "@/lib/dto";
import { formatDate } from "@/lib/format";
import { List, Row, SectionHeading } from "../ui";
import { TypeIcon } from "../type-icon";
import { MeetingBadges } from "../planner/meeting-row";

/** A project or area's own meetings — same list style as `NotesSection` next to it, each row
 * carrying the same Notes/Transcript/Summary badges `meeting-row.tsx` already renders for the
 * Planner, so the two never draw a badge two different ways (Task 3, step 3). Read-only: a
 * meeting is filed here by accepting a suggestion or assigning it by hand elsewhere, never
 * created from this section — there is nothing to "capture" into a meeting that doesn't already
 * have a calendar event or a recording behind it. */
export function MeetingsSection({ containerId, meetings }: { containerId: number; meetings: ContainerMeetingDTO[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading count={meetings.length}>Meetings</SectionHeading>
        {meetings.length > 0 && (
          <Link href={`/planner/meetings?container=${containerId}`} className="focus-ring text-[12.5px] text-fg-muted hover:text-fg rounded-sm">
            See all in Planner
          </Link>
        )}
      </div>
      {meetings.length === 0 ? (
        <p className="text-[13px] text-fg-faint">No meetings filed here yet.</p>
      ) : (
        <List>
          {meetings.map((m) => (
            <Row key={m.item.id}>
              <TypeIcon type="meeting" />
              <Link href={`/items/${m.item.id}`} className="focus-ring shrink-0 max-w-[45%] truncate text-[13.5px] hover:text-violet-bright">
                {m.title}
              </Link>
              <span className="flex-1 truncate text-[12px] text-fg-faint">{m.startsAt ? formatDate(m.startsAt) : "Not on the calendar"}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <MeetingBadges item={m.item} />
              </div>
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}
