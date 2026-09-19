"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityCategoryDTO, ActivityMeetingDTO, ActivitySessionDTO } from "@/lib/dto";
import { Chip, Select } from "../ui";
import { fractionOfDay, formatDuration } from "./format";
import { Legend, AFK_COLOR } from "./legend";

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstChipRef = useRef<HTMLButtonElement | null>(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const open = sessions.find((s) => s.id === openId) ?? null;

  function closePopover() {
    setOpenId(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closePopover();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (openId !== null) firstChipRef.current?.focus();
  }, [openId]);

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
              onClick={(e) => {
                if (s.afk) return;
                if (openId === s.id) {
                  closePopover();
                  return;
                }
                triggerRef.current = e.currentTarget;
                setOpenId(s.id);
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
          role="dialog"
          aria-label="Relabel session"
          className="panel rounded-md p-2 absolute z-10 w-64"
          style={{ left: `${Math.min(70, fractionOfDay(open.startedAt, day) * 100)}%`, top: "2.75rem" }}
        >
          <p className="text-[12.5px] font-medium truncate">{open.appName ?? "Away"}</p>
          {(open.title ?? open.domain) && <p className="text-[11.5px] text-fg-muted truncate mb-2">{open.title ?? open.domain}</p>}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {categories.map((c, i) => (
              <Chip
                key={c.id}
                ref={i === 0 ? firstChipRef : undefined}
                active={open.categoryId === c.id}
                aria-pressed={c.id === open.categoryId}
                onClick={() => onRelabel(open.id, { categoryId: c.id })}
              >
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

      <Legend categories={categories} />
    </div>
  );
}
