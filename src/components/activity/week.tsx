import type { ActivityCategoryDTO, ActivityWeekDTO } from "@/lib/dto";
import { formatDayHeading, formatDuration } from "./format";
import { Legend } from "./legend";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayLetter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

interface Props {
  days: ActivityWeekDTO["days"];
  categories: ActivityCategoryDTO[];
  onSelectDay: (day: string) => void;
}

export function Week({ days, categories, onSelectDay }: Props) {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const maxDayMs = Math.max(1, ...days.map((d) => d.activeMs));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const nonZero = d.byCategory.filter((e) => e.ms > 0);
          const parts = nonZero.map(
            (e) => `${(e.categoryId !== null ? categoryById.get(e.categoryId)?.name : undefined) ?? "Other"} ${formatDuration(e.ms)}`,
          );
          const label = `${formatDayHeading(d.day)}, ${formatDuration(d.activeMs)}${parts.length ? `: ${parts.join(", ")}` : ""}`;
          return (
            <button
              key={d.day}
              type="button"
              onClick={() => onSelectDay(d.day)}
              aria-label={label}
              className="focus-ring flex flex-col items-center gap-1.5 w-full"
            >
              <div className="flex flex-col-reverse h-40 w-full rounded-md bg-layer-1 border border-hairline overflow-hidden">
                {d.byCategory.map((e) => {
                  if (e.ms <= 0) return null;
                  const category = e.categoryId !== null ? categoryById.get(e.categoryId) : undefined;
                  return (
                    <span
                      key={e.categoryId ?? "none"}
                      style={{ height: `${(e.ms / maxDayMs) * 100}%`, backgroundColor: category?.color ?? "var(--color-layer-3)" }}
                    />
                  );
                })}
              </div>
              <span className="text-[12px] text-fg-muted">{weekdayLetter(d.day)}</span>
              <span className="font-mono text-[11px] text-fg-faint">{formatDuration(d.activeMs)}</span>
            </button>
          );
        })}
      </div>
      <Legend categories={categories} />
    </div>
  );
}
