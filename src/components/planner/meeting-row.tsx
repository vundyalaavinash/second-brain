"use client";

import { useState } from "react";
import type { MeetingItemDTO, MeetingListDTO } from "@/lib/dto";
import type { MeetingDecision } from "@/db/enums";
import { formatClock } from "../activity/format";
import { Button, Chip } from "../ui";
import { count } from "./open-meeting";

interface Props {
  meeting: MeetingListDTO;
  onOpen: () => void;
  onNoRecord: (noRecord: boolean) => void;
  onRecord: () => void;
  onDecision: (decision: MeetingDecision, scope: "occurrence" | "series") => void;
  onOpenCalendar: () => void;
  /** Why recording is out of reach, or null when the button is live. */
  blocked: string | null;
  /** What the button has to say for itself, blocked or not. */
  recordTitle: string | null;
}

const DECISION_LABEL: Record<MeetingDecision, string> = { going: "Going", maybe: "Maybe", "not-going": "Not going" };

/** The badges a linked item has earned. Nothing is shown for a meeting with no item yet.
 * Exported so any other place a meeting item's badges are shown — the project page's own
 * Meetings section among them — reads them off the same rule, rather than a second one that
 * could drift from this one. */
export function meetingBadges(item: MeetingItemDTO | null | undefined): string[] {
  if (!item) return [];
  return [item.hasNotes && "Notes", item.hasTranscript && "Transcript", item.hasSummary && "Summary"].filter((b): b is string => !!b);
}

/** The badge chips themselves, so a badge's look — not just which ones apply — never has to be
 * redrawn twice either. */
export function MeetingBadges({ item }: { item: MeetingItemDTO | null | undefined }) {
  return (
    <>
      {meetingBadges(item).map((b) => (
        <Chip as="span" key={b} className="shrink-0">
          {b}
        </Chip>
      ))}
    </>
  );
}

export function MeetingRow({ meeting, onOpen, onNoRecord, onRecord, onDecision, onOpenCalendar, blocked, recordTitle }: Props) {
  // A decision on a recurring meeting can mean "just this once" or "every time it happens" --
  // asked once, right here, rather than guessed. A one-off meeting (no seriesId) has no series
  // to ask about, so it writes the occurrence straight away. Going back to "Going" never asks:
  // re-accepting is one click, design §7.
  const [asking, setAsking] = useState<MeetingDecision | null>(null);

  function choose(decision: MeetingDecision) {
    if (decision !== "going" && meeting.seriesId) {
      setAsking(decision);
      return;
    }
    onDecision(decision, "occurrence");
  }

  function answer(scope: "occurrence" | "series") {
    if (asking) onDecision(asking, scope);
    setAsking(null);
  }

  return (
    <li
      className={`hairline-row flex items-center gap-3 px-3 py-2 min-h-11 flex-wrap hover:bg-layer-2 transition-colors ${meeting.decision === "not-going" ? "opacity-70" : ""}`}
    >
      <span className="font-mono text-[11px] text-fg-faint shrink-0 w-24">
        {meeting.allDay ? "All day" : `${formatClock(meeting.startsAt)}–${formatClock(meeting.endsAt)}`}
      </span>
      <button type="button" onClick={onOpen} className="focus-ring text-left flex-1 min-w-[12ch] truncate text-[13.5px] rounded-sm">
        <span data-testid="meeting-title">{meeting.title}</span>
      </button>
      {meeting.organizer && <span className="text-[12px] text-fg-faint shrink-0 truncate max-w-[20ch]">{meeting.organizer}</span>}
      {meeting.attendees > 0 && <span className="text-[12px] text-fg-faint shrink-0 whitespace-nowrap">{count(meeting.attendees, "attendee")}</span>}
      <MeetingBadges item={meeting.item} />
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
      <div role="group" aria-label={`Decision for ${meeting.title}`} className="flex items-center gap-1 shrink-0">
        {(["going", "maybe", "not-going"] as const).map((d) => (
          <Chip
            key={d}
            active={meeting.decision === d}
            aria-pressed={meeting.decision === d}
            onClick={() => choose(d)}
            className="h-6 px-2 text-[11.5px]"
          >
            {DECISION_LABEL[d]}
          </Chip>
        ))}
      </div>
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
      {asking && (
        <span className="w-full basis-full flex items-center gap-2 text-[12px] text-fg-muted pl-[calc(6rem+0.75rem)]">
          Just this one, or every time this meeting happens?
          <Button size="sm" variant="ghost" onClick={() => answer("occurrence")} className="shrink-0">
            Just this one
          </Button>
          <Button size="sm" variant="ghost" onClick={() => answer("series")} className="shrink-0">
            Every time
          </Button>
        </span>
      )}
      {!asking && meeting.decision === "not-going" && (
        <p className="w-full basis-full text-[12px] text-fg-faint m-0 pl-[calc(6rem+0.75rem)] flex items-center gap-2 flex-wrap">
          This is your record, not a reply.
          <Button size="sm" variant="ghost" onClick={onOpenCalendar} className="shrink-0">
            Open in Calendar to tell the organiser
          </Button>
        </p>
      )}
    </li>
  );
}
