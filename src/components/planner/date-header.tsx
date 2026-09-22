import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDayHeading } from "../activity/format";
import { Button } from "../ui";

interface Props {
  /** The day the numeral names: the shown day, or the week's first day. */
  date: string;
  /** The mono line under the arrows, e.g. "3 planned, 2 due, 4 meetings". */
  summary: string;
  /** The three navigation links. Left out on a view that is not navigated by date. */
  prevHref?: string;
  nextHref?: string;
  todayHref?: string;
  unit: "day" | "week";
}

/** "Tuesday 22 September" split into the weekday and the rest, so the header can stack them. */
function headingParts(day: string): { weekday: string; date: string } {
  const [weekday, ...rest] = formatDayHeading(day).split(" ");
  return { weekday, date: rest.join(" ") };
}

export function DateHeader({ date, summary, prevHref, nextHref, todayHref, unit }: Props) {
  const parts = headingParts(date);
  const numeral = String(Number(date.slice(8, 10)));
  const noun = unit === "day" ? "day" : "week";
  return (
    <header className="flex items-end gap-4 flex-wrap">
      <span className="font-doc text-[96px] leading-[0.9] font-medium">{numeral}</span>
      <span className="flex flex-col pb-1">
        <span className="text-[18px]">{unit === "day" ? parts.weekday : "Week of"}</span>
        <span className="text-fg-muted">{parts.date}</span>
      </span>
      <span className="ml-auto flex flex-col items-end gap-2 pb-2">
        {prevHref && nextHref && todayHref && (
          <span className="flex items-center gap-1">
            <Button href={prevHref} size="sm" variant="ghost" icon={ChevronLeft} aria-label={`Previous ${noun}`} />
            <Button href={todayHref} size="sm" variant="ghost">
              {unit === "day" ? "Today" : "This week"}
            </Button>
            <Button href={nextHref} size="sm" variant="ghost" icon={ChevronRight} aria-label={`Next ${noun}`} />
          </span>
        )}
        <span className="font-mono text-[12px] text-fg-muted">{summary}</span>
      </span>
    </header>
  );
}
