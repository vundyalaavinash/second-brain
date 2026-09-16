"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pause } from "lucide-react";
import { Button, Chip, IconButton, PageHeader } from "../ui";
import { addDaysLocal, formatDayHeading, formatDuration, todayLocal } from "./format";
import { StatusStrip } from "./status-strip";
import { Timeline } from "./timeline";
import { Totals } from "./totals";
import { Meetings } from "./meetings";
import type { ActivityDayDTO, ItemDTO } from "@/lib/dto";

const POLL_MS = 30_000;

export function ActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const day = searchParams.get("date") ?? todayLocal();
  const [data, setData] = useState<ActivityDayDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  function setDay(d: string) {
    router.replace(`/activity?date=${d}`);
  }

  function go(n: number) {
    setDay(addDaysLocal(day, n));
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

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
      <PageHeader
        title={formatDayHeading(day)}
        meta={
          data ? (
            <span>
              <span className="font-mono">{formatDuration(data.activeMs)}</span> active
            </span>
          ) : (
            "Loading"
          )
        }
        actions={
          <div className="flex items-center gap-1">
            <IconButton label="Previous day" icon={ChevronLeft} onClick={() => go(-1)} />
            <IconButton label="Next day" icon={ChevronRight} onClick={() => go(1)} disabled={day >= todayLocal()} />
            <Button variant="ghost" size="sm" onClick={() => setDay(todayLocal())}>
              Today
            </Button>
            <Chip icon={Pause} active={data?.paused ?? false} aria-pressed={data?.paused ?? false} onClick={() => void togglePause()}>
              {data?.paused ? "Paused" : "Pause"}
            </Chip>
          </div>
        }
      />

      {error && <p className="text-[13px] text-danger">{error}</p>}
      {data && <StatusStrip helper={data.helper} paused={data.paused} />}
      {data && <Timeline day={day} sessions={data.sessions} categories={data.categories} meetings={data.meetings} onRelabel={(id, patch) => void relabel(id, patch)} />}
      {data && <Totals data={data} />}
      {data && <Meetings meetings={data.meetings} onCapture={(id) => void capture(id)} />}
    </div>
  );
}
