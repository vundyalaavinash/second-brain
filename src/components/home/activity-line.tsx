import Link from "next/link";
import type { HomeDTO } from "@/lib/dto";
import { formatDuration } from "../activity/format";

/**
 * How the day has gone: the time awake at the machine, and the three things that took most of
 * it. Nothing at all where the helper has never reported — spec §2 hides the section rather
 * than explaining its absence.
 */
export function ActivityLine({ activity }: { activity: HomeDTO["activity"] }) {
  if (!activity) return null;
  return (
    <section aria-label="Activity today" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="micro">Activity today</span>
        <Link href="/activity" className="focus-ring rounded-sm text-[12px] text-fg-muted hover:text-fg transition-colors duration-150">
          Activity
        </Link>
      </div>
      {activity.top.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">Nothing tracked yet today</p>
      ) : (
        <>
          <span className="font-mono text-[12px] text-fg-muted">
            <span className="text-fg">{formatDuration(activity.activeMs)}</span> active
          </span>
          <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
            {activity.top.map((row) => (
              <li key={row.label} className="font-mono text-[11.5px] text-fg-faint flex items-baseline gap-2 min-w-0">
                <span className="flex-1 min-w-0 truncate">{row.label}</span>
                <span className="shrink-0">{formatDuration(row.ms)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
