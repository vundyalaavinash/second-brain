"use client";

import Link from "next/link";
import type { HomeDTO, PlannerDayDTO } from "@/lib/dto";
import { count } from "../planner/open-meeting";
import { CapacityLine } from "../planner/capacity-line";
import { DateHeader } from "../planner/date-header";
import { formatDuration } from "../activity/format";

/** A figure worth a number, or the words for a day that has none of it. */
function figure(n: number, some: string, none: string): string {
  return n === 0 ? none : some;
}

/** Where each figure leads, in the order spec §2 reads them out. */
function figures(counts: HomeDTO["counts"]): { href: string; label: string }[] {
  return [
    { href: "/planner", label: figure(counts.planned, `${counts.planned} planned`, "Nothing planned") },
    { href: "/planner/meetings", label: figure(counts.meetings, count(counts.meetings, "meeting"), "No meetings") },
    { href: "/inbox", label: figure(counts.inbox, `${counts.inbox} in the inbox`, "Inbox clear") },
  ];
}

interface Props {
  day: PlannerDayDTO;
  counts: HomeDTO["counts"];
  focus: HomeDTO["focus"];
  review: HomeDTO["review"];
  onHours: (workHours: string) => void;
}

/**
 * The day's own header: the Planner's numeral and weekday, its capacity line with the hours
 * chip, and the three figures under them. Home is always today, so the header carries no
 * arrows — the figures are the way out of it instead.
 *
 * Design §5.3: from Friday, a week with no review yet adds one quiet line under the figures —
 * no badge, no colour, no count, nothing that grows more insistent as Sunday nears. Once the
 * week has a review it renders nothing at all, not even a tick, because this is a nudge and the
 * research behind it is explicit that the nagging version is the one people turn off.
 */
export function TopBand({ day, counts, focus, review, onHours }: Props) {
  return (
    <header className="flex flex-col gap-3">
      <DateHeader
        date={day.date}
        unit="day"
        summary={<CapacityLine capacity={day.capacity} meetings={counts.meetings} onHours={onHours} quiet />}
      />
      <ul className="list-none m-0 p-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        {figures(counts).map((f) => (
          <li key={f.href}>
            <Link href={f.href} className="focus-ring rounded-sm hover:text-fg transition-colors duration-150">
              {f.label}
            </Link>
          </li>
        ))}
        {/* What the day has cost so far — nowhere of its own to lead to yet, so it is read, not linked. */}
        <li>{focus.minutes === 0 ? "Nothing focused yet" : `${formatDuration(focus.minutes * 60_000)} focused`}</li>
        {review.due && (
          <li>
            <Link href="/review" className="focus-ring rounded-sm text-fg-muted hover:text-fg transition-colors duration-150">
              Review your week
            </Link>
          </li>
        )}
      </ul>
    </header>
  );
}
