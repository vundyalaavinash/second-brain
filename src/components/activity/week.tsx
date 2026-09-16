import type { ActivityCategoryDTO, ActivityWeekDTO } from "@/lib/dto";
import { formatDayHeading, formatDuration } from "./format";

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
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => (
        <button
          key={d.day}
          type="button"
          onClick={() => onSelectDay(d.day)}
          aria-label={`${formatDayHeading(d.day)}: ${formatDuration(d.activeMs)}`}
          className="focus-ring flex flex-col items-center gap-1.5 w-full"
        >
          <div className="flex flex-col-reverse h-40 w-full rounded-md bg-surface-1 border border-line overflow-hidden">
            {d.byCategory.map((e) => {
              if (e.ms <= 0) return null;
              const category = e.categoryId !== null ? categoryById.get(e.categoryId) : undefined;
              return (
                <span
                  key={e.categoryId ?? "none"}
                  style={{ height: `${(e.ms / maxDayMs) * 100}%`, backgroundColor: category?.color ?? "var(--color-surface-3)" }}
                />
              );
            })}
          </div>
          <span className="text-[12px] text-fg-muted">{weekdayLetter(d.day)}</span>
          <span className="font-mono text-[11px] text-fg-faint">{formatDuration(d.activeMs)}</span>
        </button>
      ))}
    </div>
  );
}
