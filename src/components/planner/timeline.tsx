"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActivityMeetingDTO } from "@/lib/dto";
import { formatClock, todayLocal } from "../activity/format";
import { count, openMeeting } from "./open-meeting";
import { layoutBlocks } from "./timeline-layout";

/** One minute of the day is one pixel of the column: a 14-hour day is 840px, about a screen. */
const PX_PER_MIN = 1;
const TICK_MS = 60_000;
const DEFAULT_START = 7;
const DEFAULT_END = 21;

/** The hours the column covers: the working day, widened to hold every meeting on it. */
function hourRange(meetings: ActivityMeetingDTO[]): { dayStart: number; dayEnd: number } {
  let dayStart = DEFAULT_START;
  let dayEnd = DEFAULT_END;
  for (const m of meetings) {
    const from = new Date(m.startsAt);
    const to = new Date(m.endsAt);
    dayStart = Math.min(dayStart, from.getHours());
    dayEnd = Math.max(dayEnd, to.getMinutes() > 0 ? to.getHours() + 1 : to.getHours());
  }
  return { dayStart, dayEnd: Math.max(dayEnd, dayStart + 1) };
}

function label(m: ActivityMeetingDTO): string {
  return `${m.title}, ${formatClock(m.startsAt)} to ${formatClock(m.endsAt)}, ${count(m.attendees, "attendee")}`;
}

export function Timeline({ date, meetings }: { date: string; meetings: ActivityMeetingDTO[] }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  // The line is drawn from the clock, so it has no place in the server's HTML; the first
  // tick fires straight after mount and the rest follow every minute.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const allDay = meetings.filter((m) => m.allDay);
  const timed = meetings.filter((m) => !m.allDay);
  const { dayStart, dayEnd } = hourRange(timed);
  const minutes = (dayEnd - dayStart) * 60;
  const hours = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => dayStart + i);
  const blocks = layoutBlocks(timed, { dayStart, dayEnd });
  const byId = new Map(timed.map((m) => [m.id, m]));

  let nowTop: number | null = null;
  if (now !== null) {
    const at = new Date(now);
    const offset = at.getHours() * 60 + at.getMinutes() - dayStart * 60;
    if (todayLocal(at) === date && offset >= 0 && offset <= minutes) nowTop = offset;
  }

  function open(id: number) {
    void (async () => {
      const itemId = await openMeeting(id);
      if (itemId !== null) router.push(`/items/${itemId}`);
    })();
  }

  return (
    <section className="flex flex-col gap-3">
      {allDay.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">All day</span>
          {allDay.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => open(m.id)}
              className="focus-ring pane px-2.5 h-7 text-[12.5px] text-fg-muted hover:text-fg hover:bg-layer-2 transition-colors truncate max-w-[24ch]"
            >
              {m.title}
            </button>
          ))}
        </div>
      )}

      <div className="relative pl-14" style={{ height: minutes * PX_PER_MIN }}>
        {hours.map((hour) => (
          <div key={hour} className="absolute left-0 right-0 flex items-start gap-2" style={{ top: (hour - dayStart) * 60 * PX_PER_MIN }}>
            <span className="font-mono text-[11px] text-fg-faint w-12 shrink-0 -translate-y-1.5 text-right">{String(hour % 24).padStart(2, "0")}:00</span>
            <span className="flex-1 border-t border-hairline" aria-hidden />
          </div>
        ))}

        {blocks.map((b) => {
          const m = byId.get(b.id);
          if (!m) return null;
          return (
            <div
              key={b.id}
              className="pane absolute overflow-hidden hover:bg-layer-2 transition-colors"
              style={{
                top: b.top * PX_PER_MIN,
                height: b.height * PX_PER_MIN,
                left: `calc(3.5rem + (100% - 3.5rem) * ${b.col / b.cols})`,
                width: `calc((100% - 3.5rem) / ${b.cols} - 4px)`,
              }}
            >
              {/* The block's own click target sits behind its text, so the Join link beside it
                * is a sibling rather than a link nested inside a button. */}
              <button type="button" aria-label={label(m)} onClick={() => open(b.id)} className="absolute inset-0 focus-ring rounded-md" />
              <div className="relative pointer-events-none p-2 flex flex-col gap-0.5 h-full">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[13px]">{m.title}</span>
                  {m.itemId !== null && <span className="w-1.5 h-1.5 rounded-full bg-violet shrink-0" aria-hidden />}
                </span>
                <span className="font-mono text-[11px] text-fg-faint">
                  {formatClock(m.startsAt)}–{formatClock(m.endsAt)}
                </span>
                {b.height >= 48 && (
                  <span className="flex items-center gap-2 text-[11.5px] text-fg-faint">
                    <span>{count(m.attendees, "attendee")}</span>
                    {m.joinUrl && (
                      <a
                        href={m.joinUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Join ${m.title}`}
                        className="focus-ring rounded-sm text-violet-bright hover:underline pointer-events-auto"
                      >
                        Join
                      </a>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {nowTop !== null && (
          <div className="absolute left-14 right-0 flex items-center pointer-events-none" style={{ top: nowTop * PX_PER_MIN }} aria-hidden>
            <span className="w-1.5 h-1.5 rounded-full bg-violet -ml-0.5 shrink-0" />
            <span className="flex-1 border-t border-violet" />
          </div>
        )}
      </div>

      {meetings.length === 0 && <p className="text-[13px] text-fg-faint m-0">No meetings on this day</p>}
    </section>
  );
}
