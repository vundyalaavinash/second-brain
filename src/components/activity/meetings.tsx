import { CalendarDays, FileText } from "lucide-react";
import { Button, Chip, EmptyState, List, Row, SectionHeading } from "../ui";
import { formatClock, formatDuration } from "./format";
import type { ActivityMeetingDTO } from "@/lib/dto";

export function Meetings({ meetings, onCapture }: { meetings: ActivityMeetingDTO[]; onCapture: (meetingId: number) => void }) {
  return (
    <section>
      <SectionHeading count={meetings.length}>Meetings</SectionHeading>
      {meetings.length === 0 ? (
        <EmptyState icon={CalendarDays} text="No meetings on this day." />
      ) : (
        <List>
          {meetings.map((m) => (
            <Row key={m.id}>
              <span className="flex-1 min-w-0 flex items-center gap-2">
                <span className="truncate text-[13px]">{m.title}</span>
                {m.interview && <Chip as="span">Interview</Chip>}
              </span>
              <span className="font-mono text-[11px] text-fg-faint shrink-0">
                {formatClock(m.startsAt)}–{formatClock(m.endsAt)}
              </span>
              <span className="text-[12px] text-fg-faint shrink-0 whitespace-nowrap">
                in call {formatDuration(m.actualMs)} of {formatDuration(m.scheduledMs)}
              </span>
              <span className="text-[12px] text-fg-faint shrink-0 whitespace-nowrap">{m.attendees} attendees</span>
              {m.itemId ? (
                <Button href={`/items/${m.itemId}`} size="sm" variant="ghost">
                  Open note
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon={FileText} onClick={() => onCapture(m.id)}>
                  Capture as meeting note
                </Button>
              )}
            </Row>
          ))}
        </List>
      )}
    </section>
  );
}
