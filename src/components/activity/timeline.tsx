"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityCategoryDTO, ActivityMeetingDTO, ActivitySessionDTO } from "@/lib/dto";
import { Chip, Select } from "../ui";
import { fractionOfDay, formatDuration } from "./format";

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];
const AFK_COLOR = "var(--color-surface-3)";
const DEFAULT_COLOR = "#62626b";

interface Props {
  day: string;
  sessions: ActivitySessionDTO[];
  categories: ActivityCategoryDTO[];
  meetings: ActivityMeetingDTO[];
  onRelabel: (sessionId: number, patch: { categoryId?: number | null; meetingId?: number | null }) => void;
}

export function Timeline({ day, sessions, categories, meetings, onRelabel }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const open = sessions.find((s) => s.id === openId) ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenId(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <div className="relative h-10 rounded-md bg-surface-1 border border-line overflow-hidden">
        {sessions.map((s) => {
          const startFrac = fractionOfDay(s.startedAt, day);
          const endFrac = fractionOfDay(s.endedAt, day);
          const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
          const color = s.afk ? AFK_COLOR : (s.categoryId !== null ? categoryById.get(s.categoryId)?.color : undefined) ?? DEFAULT_COLOR;
          const label = `${s.appName ?? "Away"}: ${s.title ?? s.domain ?? ""} (${formatDuration(ms)})`;
          return (
            <button
              key={s.id}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => {
                if (s.afk) return;
                setOpenId((id) => (id === s.id ? null : s.id));
              }}
              className="focus-ring absolute top-0 h-full"
              style={{ left: `${startFrac * 100}%`, width: `${Math.max(0.15, (endFrac - startFrac) * 100)}%`, backgroundColor: color }}
            />
          );
        })}
      </div>
      <div className="relative h-4">
        {HOUR_TICKS.map((h) => (
          <span key={h} className="absolute font-mono text-[10px] text-fg-faint" style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, "0")}:00
          </span>
        ))}
      </div>

      {open && (
        <div
          className="frost rounded-md p-2 absolute z-10 w-64"
          style={{ left: `${Math.min(70, fractionOfDay(open.startedAt, day) * 100)}%`, top: "2.75rem" }}
        >
          <p className="text-[12.5px] font-medium truncate">{open.appName ?? "Away"}</p>
          {(open.title ?? open.domain) && <p className="text-[11.5px] text-fg-muted truncate mb-2">{open.title ?? open.domain}</p>}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {categories.map((c) => (
              <Chip key={c.id} active={open.categoryId === c.id} onClick={() => onRelabel(open.id, { categoryId: c.id })}>
                {c.name}
              </Chip>
            ))}
          </div>
          {meetings.length > 0 && (
            <Select
              size="sm"
              className="w-full"
              value={open.meetingId ?? ""}
              onChange={(e) => onRelabel(open.id, { meetingId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No meeting</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[12px] text-fg-muted">
        {categories.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden />
            {c.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: AFK_COLOR }} aria-hidden />
          Away
        </span>
      </div>
    </div>
  );
}
