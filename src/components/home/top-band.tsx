"use client";

import Link from "next/link";
import type { HomeDTO, PlannerDayDTO } from "@/lib/dto";
import { count } from "../planner/open-meeting";
import { CapacityLine } from "../planner/capacity-line";
import { DateHeader } from "../planner/date-header";

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
  onHours: (workHours: string) => void;
}

/**
 * The day's own header: the Planner's numeral and weekday, its capacity line with the hours
 * chip, and the three figures under them. Home is always today, so the header carries no
 * arrows — the figures are the way out of it instead.
 */
export function TopBand({ day, counts, onHours }: Props) {
  return (
    <header className="flex flex-col gap-3">
      <DateHeader
        date={day.date}
        unit="day"
        summary={<CapacityLine capacity={day.capacity} planned={counts.planned} meetings={counts.meetings} onHours={onHours} />}
      />
      <ul className="list-none m-0 p-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        {figures(counts).map((f) => (
          <li key={f.href}>
            <Link href={f.href} className="focus-ring rounded-sm hover:text-fg transition-colors duration-150">
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </header>
  );
}
