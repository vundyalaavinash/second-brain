"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { PlannerCalendarDTO, PlannerDayDTO, PlannerMeetingsDTO, PlannerWeekDTO } from "@/lib/dto";
import { setPlanDate } from "@/lib/plan-date";
import { Crumb } from "../shell/crumb";
import { addDaysLocal } from "../activity/format";
import { CapacityLine } from "./capacity-line";
import { DateHeader } from "./date-header";
import { DayView } from "./day-view";
import { MeetingsView, dayOf } from "./meetings-view";
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

/** One interaction often moves a task and the plan in the same breath; the day is ~a quarter
 * of a megabyte, so the two events are let to settle into one request. */
const DAY_REFRESH_MS = 50;

/** The one panel the tabs speak for: each view is a route, so only the open one is ever rendered. */
const PANEL_ID = "planner-panel";
const tabId = (view: PlannerView) => `planner-tab-${view}`;

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
            id={tabId(tab.view)}
            role="tab"
            aria-selected={selected}
            aria-controls={PANEL_ID}
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
  // A week is seven days, not one: a task typed while it is open lands on today when today is
  // in the week on screen, and on that week's first day when it is not.
  const weekPlanDate = weekStart === null ? null : today >= weekStart && today < addDaysLocal(weekStart, 7) ? today : weekStart;
  const selectedDate = dayDate ?? weekPlanDate;

  // A task typed into the prompt bar while the Planner is open lands on the day being shown.
  useEffect(() => {
    setPlanDate(selectedDate);
    return () => setPlanDate(null);
  }, [selectedDate]);

  // A trailing timer coalesces a burst of change events, and a monotonic request id keeps a
  // day that was asked for earlier from landing on top of a newer one.
  const dayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayRequest = useRef(0);
  // A pending refresh belongs to the date it was asked for; moving to another day drops it.
  useEffect(() => () => {
    if (dayTimer.current) clearTimeout(dayTimer.current);
  }, [dayDate]);

  const refreshDay = useCallback(() => {
    if (!dayDate) return;
    if (dayTimer.current) clearTimeout(dayTimer.current);
    dayTimer.current = setTimeout(() => {
      dayTimer.current = null;
      const request = ++dayRequest.current;
      void (async () => {
        const res = await fetch(`/api/planner/day?date=${dayDate}`);
        if (!res.ok) return;
        const body = (await res.json()) as PlannerDayDTO;
        // A slower earlier request answering last would put the day back as it was.
        if (request === dayRequest.current) setDay(body);
      })();
    }, DAY_REFRESH_MS);
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

  // The capacity is reckoned server-side, so new hours are saved and then read back whole.
  const saveHours = useCallback(
    (workHours: string) => {
      void (async () => {
        const res = await fetch("/api/settings/planner", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workHours }) });
        // A refused save leaves the old hours on screen; the toast is the only word about it.
        if (res.ok) refreshDay();
        else window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Could not save the hours" } }));
      })();
    },
    [refreshDay],
  );

  const calendar: PlannerCalendarDTO | null = day?.calendar ?? meetings?.calendar ?? null;
  // Meetings is not navigated by date, so it keeps the header's numeral and drops the arrows.
  const meetingCounts = meetings && {
    today: meetings.meetings.filter((m) => dayOf(m.startsAt) === today).length,
    upcoming: meetings.meetings.filter((m) => dayOf(m.startsAt) > today).length,
  };

  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-6">
      <Crumb title={CRUMB[view]} />

      {day && (
        <DateHeader
          date={day.date}
          unit="day"
          summary={
            // The figures `homePayload` reckons, so `/` and `/planner` never read different
            // numbers for the same day: a declined or all-day meeting takes none of the hours.
            <CapacityLine
              capacity={day.capacity}
              meetings={day.meetings.filter((m) => !m.allDay && m.status !== "declined").length}
              onHours={saveHours}
            />
          }
          prevHref={`/planner?date=${addDaysLocal(day.date, -1)}`}
          nextHref={`/planner?date=${addDaysLocal(day.date, 1)}`}
          todayHref="/planner"
        />
      )}
      {week && (
        <DateHeader
          date={week.start}
          unit="week"
          summary={`${count(week.days.reduce((n, d) => n + d.meetings.filter((m) => !m.allDay && m.status !== "declined").length, 0), "meeting")}, ${week.days.reduce((n, d) => n + d.due.length, 0)} due`}
          prevHref={`/planner/week?start=${addDaysLocal(week.start, -7)}`}
          nextHref={`/planner/week?start=${addDaysLocal(week.start, 7)}`}
          todayHref="/planner/week"
        />
      )}

      {meetingCounts && <DateHeader date={today} unit="day" summary={`${meetingCounts.today} today, ${meetingCounts.upcoming} upcoming`} />}

      <Tabs view={view} />

      {calendar && <SetupCard calendar={calendar} />}

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(view)}>
        {day && <DayView day={day} today={today} onRefresh={refreshDay} />}
        {week && <WeekView week={week} today={today} onRefresh={refreshWeek} />}
        {meetings && <MeetingsView today={today} meetings={meetings.meetings} onRefresh={refreshMeetings} />}
      </div>
    </div>
  );
}
