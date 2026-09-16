"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pause, SlidersHorizontal } from "lucide-react";
import { Button, Chip, IconButton, PageHeader } from "../ui";
import { addDaysLocal, formatDayHeading, formatDuration, todayLocal } from "./format";
import { StatusStrip } from "./status-strip";
import { Timeline } from "./timeline";
import { Totals } from "./totals";
import { Meetings } from "./meetings";
import { Week } from "./week";
import { RulesDrawer } from "./rules-drawer";
import type { ActivityDayDTO, ActivityWeekDTO, ItemDTO } from "@/lib/dto";

const POLL_MS = 30_000;

type View = "day" | "week";

/** Monday of the week containing `day`, as a local YYYY-MM-DD string. */
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return addDaysLocal(day, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}

export function ActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const day = searchParams.get("date") ?? todayLocal();
  const view: View = searchParams.get("view") === "week" ? "week" : "day";
  const weekStart = mondayOf(day);
  const [data, setData] = useState<ActivityDayDTO | null>(null);
  const [weekData, setWeekData] = useState<ActivityWeekDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/activity/day?date=${day}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
          return;
        }
        const json = (await res.json()) as ActivityDayDTO;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    if (day !== todayLocal()) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [day, reloadToken]);

  useEffect(() => {
    if (view !== "week") return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/activity/week?start=${weekStart}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
          return;
        }
        const json = (await res.json()) as ActivityWeekDTO;
        if (cancelled) return;
        setWeekData(json);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [view, weekStart, reloadToken]);

  function navigate(d: string, v: View) {
    const params = new URLSearchParams({ date: d });
    if (v === "week") params.set("view", "week");
    router.replace(`/activity?${params.toString()}`);
  }

  function setDay(d: string) {
    navigate(d, view);
  }

  function setView(v: View) {
    navigate(day, v);
  }

  function go(n: number) {
    setDay(addDaysLocal(day, view === "week" ? n * 7 : n));
  }

  async function togglePause() {
    if (!data) return;
    await fetch("/api/activity/pause", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: !data.paused }),
    });
    reload();
    window.dispatchEvent(new Event("sb:activity-changed"));
  }

  async function relabel(sessionId: number, patch: { categoryId?: number | null; meetingId?: number | null }) {
    await fetch(`/api/activity/sessions/${sessionId}/label`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    reload();
  }

  async function capture(meetingId: number) {
    const res = await fetch(`/api/activity/meetings/${meetingId}/capture`, { method: "POST" });
    if (!res.ok) return;
    const item = (await res.json()) as ItemDTO;
    router.push(`/items/${item.id}`);
  }

  const weekTotalMs = weekData ? weekData.days.reduce((sum, d) => sum + d.activeMs, 0) : 0;
  const nextDisabled = view === "week" ? weekStart >= mondayOf(todayLocal()) : day >= todayLocal();

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <PageHeader
        title={view === "week" ? `Week of ${formatDayHeading(weekStart)}` : formatDayHeading(day)}
        meta={
          view === "week" ? (
            weekData ? (
              <span>
                <span className="font-mono">{formatDuration(weekTotalMs)}</span> active
              </span>
            ) : (
              "Loading"
            )
          ) : data ? (
            <span>
              <span className="font-mono">{formatDuration(data.activeMs)}</span> active
            </span>
          ) : (
            "Loading"
          )
        }
        actions={
          <div className="flex items-center gap-1">
            <Chip active={view === "day"} aria-pressed={view === "day"} onClick={() => setView("day")}>
              Day
            </Chip>
            <Chip active={view === "week"} aria-pressed={view === "week"} onClick={() => setView("week")}>
              Week
            </Chip>
            <IconButton label={view === "week" ? "Previous week" : "Previous day"} icon={ChevronLeft} onClick={() => go(-1)} />
            <IconButton label={view === "week" ? "Next week" : "Next day"} icon={ChevronRight} onClick={() => go(1)} disabled={nextDisabled} />
            <Button variant="ghost" size="sm" onClick={() => setDay(todayLocal())}>
              Today
            </Button>
            <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => setRulesOpen(true)}>
              Rules
            </Button>
            <Chip icon={Pause} active={data?.paused ?? false} aria-pressed={data?.paused ?? false} onClick={() => void togglePause()}>
              {data?.paused ? "Paused" : "Pause"}
            </Chip>
          </div>
        }
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {view === "day" ? (
        <>
          {data && <StatusStrip helper={data.helper} paused={data.paused} />}
          {data && (
            <Timeline day={day} sessions={data.sessions} categories={data.categories} meetings={data.meetings} onRelabel={(id, patch) => void relabel(id, patch)} />
          )}
          {data && <Totals data={data} />}
          {data && <Meetings meetings={data.meetings} onCapture={(id) => void capture(id)} />}
        </>
      ) : (
        weekData && <Week days={weekData.days} categories={weekData.categories} onSelectDay={(d) => navigate(d, "day")} />
      )}

      {rulesOpen && <RulesDrawer retentionDays={data?.retentionDays ?? 90} onClose={() => setRulesOpen(false)} reload={reload} />}
    </div>
  );
}
