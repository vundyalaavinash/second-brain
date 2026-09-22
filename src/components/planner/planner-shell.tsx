"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { PlannerCalendarDTO, PlannerDayDTO, PlannerMeetingsDTO, PlannerWeekDTO } from "@/lib/dto";
import { setPlanDate } from "@/lib/plan-date";
import { Crumb } from "../shell/crumb";
import { addDaysLocal } from "../activity/format";
import { DateHeader } from "./date-header";
import { DayView } from "./day-view";
import { MeetingsView } from "./meetings-view";
import { SetupCard } from "./setup-card";
import { WeekView } from "./week-view";
import { count } from "./open-meeting";

export type PlannerView = "day" | "week" | "meetings";

type ViewProps =
  | { view: "day"; initial: PlannerDayDTO }
  | { view: "week"; initial: PlannerWeekDTO }
  | { view: "meetings"; initial: PlannerMeetingsDTO };

/** `today` comes from the server with the payload, so the first paint and the hydration agree. */
type Props = ViewProps & { today: string };

const TABS: { view: PlannerView; label: string; href: string }[] = [
  { view: "day", label: "Day", href: "/planner" },
  { view: "week", label: "Week", href: "/planner/week" },
  { view: "meetings", label: "Meetings", href: "/planner/meetings" },
];

const TAB = "focus-ring relative rounded-full h-7 px-3 flex items-center text-[12.5px] transition-colors duration-150";

const CRUMB: Record<PlannerView, string> = { day: "Planner", week: "Week", meetings: "Meetings" };

function Tabs({ view }: { view: PlannerView }) {
  const reduce = useReducedMotion();
  return (
    <div role="tablist" aria-label="Planner views" className="pane rounded-full p-1 flex items-center gap-1 self-start">
      {TABS.map((tab) => {
        const selected = tab.view === view;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={selected}
            className={`${TAB} ${selected ? "text-fg" : "text-fg-muted hover:text-fg"}`}
          >
            {/* The indicator slides between the tabs; under reduced motion it is drawn plainly
              * under the selected one, because a shared layout id would animate regardless. */}
            {selected &&
              (reduce ? (
                <span className="absolute inset-0 rounded-full bg-violet-dim" aria-hidden />
              ) : (
                <motion.span layoutId="planner-tab" className="absolute inset-0 rounded-full bg-violet-dim" aria-hidden />
              ))}
            <span className="relative">{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function PlannerShell(props: Props) {
  const { view, today } = props;
  const [day, setDay] = useState<PlannerDayDTO | null>(props.view === "day" ? props.initial : null);
  const [week, setWeek] = useState<PlannerWeekDTO | null>(props.view === "week" ? props.initial : null);
  const [meetings, setMeetings] = useState<PlannerMeetingsDTO | null>(props.view === "meetings" ? props.initial : null);

  // The dates stay out of the refresh callbacks' identities, so a reload does not re-register
  // the listeners the panes hang off them.
  const dayDate = day?.date ?? null;
  const weekStart = week?.start ?? null;
  const selectedDate = dayDate ?? weekStart;

  // A task typed into the prompt bar while the Planner is open lands on the day being shown.
  useEffect(() => {
    setPlanDate(selectedDate);
    return () => setPlanDate(null);
  }, [selectedDate]);

  const refreshDay = useCallback(() => {
    if (!dayDate) return;
    void (async () => {
      const res = await fetch(`/api/planner/day?date=${dayDate}`);
      if (res.ok) setDay((await res.json()) as PlannerDayDTO);
    })();
  }, [dayDate]);

  const refreshWeek = useCallback(() => {
    if (!weekStart) return;
    void (async () => {
      const res = await fetch(`/api/planner/week?start=${weekStart}`);
      if (res.ok) setWeek((await res.json()) as PlannerWeekDTO);
    })();
  }, [weekStart]);

  const meetingWindow = meetings ? `${meetings.from}|${meetings.to}` : null;
  const refreshMeetings = useCallback(() => {
    if (!meetingWindow) return;
    const [from, to] = meetingWindow.split("|");
    void (async () => {
      const res = await fetch(`/api/meetings?from=${from}&to=${to}`);
      if (!res.ok) return;
      const body = (await res.json()) as { meetings: PlannerMeetingsDTO["meetings"] };
      setMeetings((prev) => (prev ? { ...prev, meetings: body.meetings } : prev));
    })();
  }, [meetingWindow]);

  const calendar: PlannerCalendarDTO | null = day?.calendar ?? meetings?.calendar ?? null;

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-6">
      <Crumb title={CRUMB[view]} />

      {day && (
        <DateHeader
          date={day.date}
          unit="day"
          summary={`${day.plan.length} planned, ${day.due.overdue.length + day.due.today.length} due, ${count(day.meetings.length, "meeting")}`}
          prevHref={`/planner?date=${addDaysLocal(day.date, -1)}`}
          nextHref={`/planner?date=${addDaysLocal(day.date, 1)}`}
          todayHref="/planner"
        />
      )}
      {week && (
        <DateHeader
          date={week.start}
          unit="week"
          summary={`${count(week.days.reduce((n, d) => n + d.meetings.length, 0), "meeting")}, ${week.days.reduce((n, d) => n + d.due.length, 0)} due`}
          prevHref={`/planner/week?start=${addDaysLocal(week.start, -7)}`}
          nextHref={`/planner/week?start=${addDaysLocal(week.start, 7)}`}
          todayHref="/planner/week"
        />
      )}

      <Tabs view={view} />

      {calendar && <SetupCard calendar={calendar} />}

      {day && <DayView day={day} today={today} onRefresh={refreshDay} />}
      {week && <WeekView week={week} today={today} onRefresh={refreshWeek} />}
      {meetings && <MeetingsView today={today} meetings={meetings.meetings} onRefresh={refreshMeetings} />}
    </div>
  );
}
