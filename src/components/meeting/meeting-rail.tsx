"use client";

import Link from "next/link";
import { Inbox as InboxIcon } from "lucide-react";
import type { ActivityMeetingDTO, ItemDTO, TaskDTO } from "@/lib/dto";
import { formatDate } from "@/lib/format";
import { Chip } from "../ui";
import { Rail, RailRow, RailSection } from "../shell/rail";
import { KIND_ICON, StatusDot } from "../type-icon";
import { formatClock, formatDayHeading, todayLocal } from "../activity/format";
import type { TaskHome } from "./summary-pane";

/** Rounded to one decimal above a megabyte, which is the only scale a WAV of speech reaches. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} kB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** mm:ss for a span of seconds, the same shape the transcript uses. */
export function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  item: ItemDTO;
  event: ActivityMeetingDTO | null;
  tasks: TaskDTO[];
  /** Seconds the recording ran, or null when nothing has been recorded. */
  recordingSeconds: number | null;
  /** Size of the WAV on disk, measured on the server. */
  recordingBytes: number | null;
  /** Where a task made from this meeting lives, for the linked-task links. */
  home: TaskHome;
  onMove: () => void;
}

/** The meeting page's context column: when it was, who was there, and what it produced. */
export function MeetingRail({ item, event, tasks, recordingSeconds, recordingBytes, home, onMove }: Props) {
  const attendees = event?.attendeeNames ?? [];
  return (
    <Rail>
      <RailSection label="Details">
        <div className="flex flex-col gap-2">
          <RailRow label="When">
            {event ? (
              <span>
                {formatDayHeading(todayLocal(new Date(event.startsAt)))}{" "}
                <span className="font-mono">
                  {event.allDay ? "all day" : `${formatClock(event.startsAt)}–${formatClock(event.endsAt)}`}
                </span>
              </span>
            ) : (
              <span className="font-mono">{formatDate(item.createdAt)}</span>
            )}
          </RailRow>
          <RailRow label="Calendar">
            <span>{event?.calendarTitle || "Not on a calendar"}</span>
          </RailRow>
          <RailRow label="Status">
            <StatusDot status={item.status} error={item.error} />
          </RailRow>
          <RailRow label="Home">
            <Chip icon={item.container ? KIND_ICON[item.container.kind] : InboxIcon} onClick={onMove}>
              {item.container ? item.container.name : "Inbox"}
            </Chip>
          </RailRow>
          {recordingSeconds !== null && (
            <RailRow label="Recording">
              <span className="font-mono">{formatSpan(recordingSeconds)}</span>
            </RailRow>
          )}
          {recordingBytes !== null && (
            <RailRow label="Audio">
              <span className="font-mono">{formatBytes(recordingBytes)}</span>
            </RailRow>
          )}
          <RailRow label="Id">
            <span className="font-mono">#{item.id}</span>
          </RailRow>
        </div>
      </RailSection>

      <RailSection label="Attendees" count={attendees.length || undefined}>
        {attendees.length === 0 ? (
          <p className="text-[13px] text-fg-faint">Nobody was listed</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((name) => (
              <Chip as="span" key={name}>
                {name}
              </Chip>
            ))}
          </div>
        )}
      </RailSection>

      <RailSection label="Linked tasks" count={tasks.length}>
        {tasks.length === 0 ? (
          <p className="text-[13px] text-fg-faint">No tasks from this meeting yet</p>
        ) : (
          <ul role="list" className="list-none m-0 p-0 flex flex-col">
            {tasks.map((t) => (
              <li key={t.id} className="hairline-row py-1.5">
                <Link
                  href={t.containerId === item.containerId ? home.href : "/inbox"}
                  className={`focus-ring block rounded-sm truncate text-[13px] ${t.status === "done" ? "text-fg-faint line-through" : "text-fg-muted hover:text-fg"}`}
                >
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </Rail>
  );
}
