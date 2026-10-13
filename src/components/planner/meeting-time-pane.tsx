"use client";

import { useEffect, useState } from "react";
import { FolderOpen, PieChart } from "lucide-react";
import Link from "next/link";
import { Chip } from "../ui";
import { addDaysLocal } from "../activity/format";

interface Row {
  containerId: number;
  name: string;
  kind: string;
  slug: string;
  meetings: number;
  minutes: number;
}

interface Payload {
  byContainer: Row[];
  unattributed: { meetings: number; minutes: number };
}

/** Hours to one decimal below ten, whole hours above: "6.5h" reads, "6h" is enough at scale. */
function hours(minutes: number): string {
  const h = minutes / 60;
  if (minutes < 60) return `${minutes}m`;
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}

/**
 * Where meeting time went, by project or area, over the window the meetings list is showing.
 *
 * The question this answers -- "where is the major time going" -- could not be asked before:
 * every meeting could be attributed, and `containerMeetingRollup` has been able to price a single
 * project since the attribution work, but nothing ranked them against each other.
 *
 * The unattributed total is shown deliberately and never folded into a bucket: it is the measure
 * of how much the rest of the number can be trusted. A chart of three labelled projects beside
 * nineteen hours nobody claimed is a chart that lies.
 */
/** How far back "where the time went" looks. */
const WINDOW_DAYS = 30;

export function MeetingTimePane({ today }: { today: string }) {
  const [data, setData] = useState<Payload | null>(null);
  // Deliberately a trailing window, not the meetings list's own -30/+60. That list is something
  // to act on, so it reaches into the future; this is a measure of time *spent*, and counting
  // meetings that have not happened yet would answer a different question while looking like it
  // answered this one. `to` is exclusive, so tomorrow includes today.
  const from = addDaysLocal(today, -WINDOW_DAYS);
  const to = addDaysLocal(today, 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/meetings/attribution?from=${from}&to=${to}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const body = (await res.json()) as Payload;
      if (!cancelled) setData(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  if (!data) return null;
  const { byContainer, unattributed } = data;
  if (byContainer.length === 0 && unattributed.meetings === 0) return null;

  const most = byContainer[0]?.minutes ?? 0;

  return (
    <section className="pane p-3 flex flex-col gap-2" aria-label="Where meeting time goes">
      <header className="flex items-center gap-2">
        <PieChart className="w-4 h-4 text-fg-muted shrink-0" aria-hidden />
        <span className="text-[12.5px]">Where meeting time went</span>
        <span className="text-[11.5px] text-fg-faint">last {WINDOW_DAYS} days</span>
      </header>

      {byContainer.length === 0 ? (
        <p className="m-0 text-[12.5px] text-fg-faint">Nothing is attributed yet. Use the folder on a meeting to say what it counts against.</p>
      ) : (
        <ul role="list" className="list-none m-0 p-0 flex flex-col gap-1">
          {byContainer.map((row) => (
            <li key={row.containerId} className="flex items-center gap-2 text-[12.5px]">
              <Link href={`/c/${row.slug}`} className="focus-ring rounded-sm flex items-center gap-1.5 min-w-[12ch] max-w-[22ch] truncate hover:underline">
                <FolderOpen className="w-3 h-3 text-fg-faint shrink-0" aria-hidden />
                <span className="truncate">{row.name}</span>
              </Link>
              {/* A bar rather than a number alone: the comparison is the point, and it is read
                  sideways in one glance. Widths are relative to the heaviest, not to the total,
                  so the longest bar is always full and the rest are legible beside it. */}
              <span className="flex-1 h-1.5 rounded-full bg-hairline overflow-hidden" aria-hidden>
                <span className="block h-full bg-violet-bright" style={{ width: most > 0 ? `${Math.max(2, (row.minutes / most) * 100)}%` : "0%" }} />
              </span>
              <span className="font-mono tabular-nums text-fg-muted shrink-0">{hours(row.minutes)}</span>
              <span className="text-fg-faint shrink-0 w-[7ch] text-right">
                {row.meetings} {row.meetings === 1 ? "mtg" : "mtgs"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unattributed.meetings > 0 && (
        <p className="m-0 flex items-center gap-2 text-[12px] text-fg-faint">
          <Chip as="span" className="shrink-0 text-warn border-warn/40">
            {hours(unattributed.minutes)} unaccounted
          </Chip>
          <span>
            {unattributed.meetings} {unattributed.meetings === 1 ? "meeting counts" : "meetings count"} against nothing yet
          </span>
        </p>
      )}
    </section>
  );
}
