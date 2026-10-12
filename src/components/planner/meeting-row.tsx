"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { ContainerDTO, MeetingItemDTO, MeetingListDTO } from "@/lib/dto";
import type { MeetingDecision } from "@/db/enums";
import { formatClock } from "../activity/format";
import { Button, Chip } from "../ui";
import { ContainerPicker } from "../container-picker";
import { count } from "./open-meeting";

interface Props {
  meeting: MeetingListDTO;
  onOpen: () => void;
  onNoRecord: (noRecord: boolean) => void;
  onRecord: () => void;
  onDecision: (decision: MeetingDecision, scope: "occurrence" | "series") => void;
  /** Assigns the meeting to the project or area it counts against. */
  onContainer: (containerId: number | null, scope: "occurrence" | "series") => void;
  /** What the meeting is attributed to today, for the control's own label. */
  containerName: string | null;
  onOpenCalendar: () => void;
  /** Why recording is out of reach, or null when the button is live. */
  blocked: string | null;
  /** What the button has to say for itself, blocked or not. */
  recordTitle: string | null;
}

const DECISION_LABEL: Record<MeetingDecision, string> = { going: "Going", maybe: "Maybe", "not-going": "Not going" };

/** The badges a linked item has earned. Nothing is shown for a meeting with no item yet. Not
 * exported: `MeetingBadges` below is what any other place a meeting item's badges are shown —
 * the project page's own Meetings section among them — actually imports, so the rule for which
 * badges apply lives in exactly one place without this helper needing a life of its own outside
 * it. */
function meetingBadges(item: MeetingItemDTO | null | undefined): string[] {
  if (!item) return [];
  return [item.hasNotes && "Notes", item.hasTranscript && "Transcript", item.hasSummary && "Summary"].filter((b): b is string => !!b);
}

/** The badge chips themselves — what every other place a meeting item's badges are shown
 * actually imports — so a badge's look — not just which ones apply — never has to be redrawn
 * twice either. */
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

export function MeetingRow({ meeting, onOpen, onNoRecord, onRecord, onDecision, onContainer, containerName, onOpenCalendar, blocked, recordTitle }: Props) {
  const [picking, setPicking] = useState(false);
  // A decision on a recurring meeting can mean "just this once" or "every time it happens" --
  // asked once, right here, rather than guessed. A one-off meeting (no seriesId) has no series
  // to ask about, so it writes the occurrence straight away. Going back to "Going" never asks
  // in the ordinary case -- re-accepting a normal recurring meeting nobody has ever declined at
  // the series level is one click, design §7 -- *unless* there is currently an active series
  // decision for this meeting's series (`meeting.seriesDecision`, independent of this occurrence's
  // own possibly-different `decision`): without asking there, "Going" would silently write only
  // an occurrence override and leave the series decision standing, so the only way to reverse a
  // declined series would be clicking Going on every future occurrence individually, forever.
  const [asking, setAsking] = useState<MeetingDecision | null>(null);

  function choose(decision: MeetingDecision) {
    if (!meeting.seriesId) {
      onDecision(decision, "occurrence");
      return;
    }
    if (decision !== "going" || meeting.seriesDecision) {
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
      {/* An icon when there is nothing to say and the project's name when there is, so an
          unattributed meeting costs one glyph of width and an attributed one reads without being
          opened. This is the only way in the app to attribute a meeting: the domain and the route
          have existed, and tested, since the attribution work, with nothing wired to them. */}
      <Chip
        active={meeting.containerId !== null}
        onClick={() => setPicking(true)}
        className="shrink-0 flex items-center gap-1"
        title={
          containerName
            ? meeting.containerFromSeries
              ? `Counts against ${containerName}, for every occurrence`
              : `Counts against ${containerName}`
            : "Attribute this meeting to a project or area"
        }
        aria-label={containerName ? `Attributed to ${containerName}. Change` : `Attribute ${meeting.title} to a project or area`}
      >
        <FolderOpen className="w-3 h-3 shrink-0" aria-hidden />
        {containerName && <span className="max-w-[14ch] truncate">{containerName}</span>}
      </Chip>
      {picking && (
        <ContainerPicker
          title={`What does "${meeting.title}" count against?`}
          allowInbox
          onClose={() => setPicking(false)}
          onPick={(container: ContainerDTO | null) => {
            setPicking(false);
            // A recurring meeting is labelled once and stays labelled -- including the occurrences
            // already past -- which is what makes this cheap enough to keep up to date. A one-off
            // has no series to apply that to, and the route rejects the attempt rather than
            // writing a single-occurrence assignment nobody asked for.
            onContainer(container?.id ?? null, meeting.seriesId ? "series" : "occurrence");
          }}
        />
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
