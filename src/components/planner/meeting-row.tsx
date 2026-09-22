"use client";

import type { MeetingListDTO } from "@/lib/dto";
import { formatClock } from "../activity/format";
import { Button, Chip } from "../ui";
import { count } from "./open-meeting";

interface Props {
  meeting: MeetingListDTO;
  onOpen: () => void;
  onNoRecord: (noRecord: boolean) => void;
  onRecord: () => void;
  /** Why recording is out of reach, or null when the button is live. */
  blocked: string | null;
  /** What the button has to say for itself, blocked or not. */
  recordTitle: string | null;
}

/** The badges the linked item has earned. Nothing is shown for a meeting with no item yet. */
function badges(meeting: MeetingListDTO): string[] {
  const item = meeting.item;
  if (!item) return [];
  return [item.hasNotes && "Notes", item.hasTranscript && "Transcript", item.hasSummary && "Summary"].filter((b): b is string => !!b);
}

export function MeetingRow({ meeting, onOpen, onNoRecord, onRecord, blocked, recordTitle }: Props) {
  return (
    <li className="hairline-row flex items-center gap-3 px-3 py-2 min-h-11 flex-wrap hover:bg-layer-2 transition-colors">
      <span className="font-mono text-[11px] text-fg-faint shrink-0 w-24">
        {meeting.allDay ? "All day" : `${formatClock(meeting.startsAt)}–${formatClock(meeting.endsAt)}`}
      </span>
      <button type="button" onClick={onOpen} className="focus-ring text-left flex-1 min-w-[12ch] truncate text-[13.5px] rounded-sm">
        <span data-testid="meeting-title">{meeting.title}</span>
      </button>
      {meeting.organizer && <span className="text-[12px] text-fg-faint shrink-0 truncate max-w-[20ch]">{meeting.organizer}</span>}
      <span className="text-[12px] text-fg-faint shrink-0 whitespace-nowrap">{count(meeting.attendees, "attendee")}</span>
      {badges(meeting).map((b) => (
        <Chip as="span" key={b} className="shrink-0">
          {b}
        </Chip>
      ))}
      {meeting.joinUrl && (
        <Button
          href={meeting.joinUrl}
          size="sm"
          variant="ghost"
          target="_blank"
          rel="noreferrer"
          aria-label={`Join ${meeting.title}`}
          className="shrink-0"
        >
          Join
        </Button>
      )}
      <Chip
        active={meeting.noRecord}
        aria-pressed={meeting.noRecord}
        onClick={() => onNoRecord(!meeting.noRecord)}
        className="shrink-0"
        title={meeting.noRecord ? "This meeting will not be recorded" : "Leave this meeting out of recording"}
      >
        Don&apos;t record
      </Chip>
      {/* A disabled button takes no pointer events, so the reason hangs on a wrapper. */}
      <span title={recordTitle ?? undefined} className="shrink-0">
        <Button size="sm" onClick={onRecord} disabled={!!blocked} title={recordTitle ?? undefined} aria-label={`Record ${meeting.title}`}>
          Record
        </Button>
      </span>
    </li>
  );
}
