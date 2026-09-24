import Link from "next/link";
import type { RecentItemDTO } from "@/lib/dto";
import { sinceLabel } from "../activity/format";
import { Chip } from "../ui";
import { TypeIcon } from "../type-icon";

/** What a recorded meeting has to show for itself: the summary if it has one, else the
 * transcript it is still only a transcript. A meeting with neither says nothing. */
function meetingChip(item: RecentItemDTO): string | null {
  if (!item.meeting) return null;
  if (item.meeting.hasSummary) return "Summary";
  return item.meeting.hasTranscript ? "Transcript" : null;
}

/**
 * The last five things touched, dated against the moment the payload was built. `now` is
 * required for that reason: a list that read the browser's clock would say "just now" on the
 * server and "1 min ago" on the first client render of the same row.
 */
export function RecentList({ recent, now }: { recent: RecentItemDTO[]; now: number }) {
  return (
    <section aria-label="Recent" className="flex flex-col gap-2">
      <span className="micro">Recent</span>
      {recent.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">Nothing captured yet</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {recent.map((item) => {
            const chip = meetingChip(item);
            return (
              <li key={item.id} className="hairline-row flex items-center gap-2.5 py-1.5 min-w-0">
                <TypeIcon type={item.type} className="w-3.5 h-3.5 text-fg-faint shrink-0" />
                <Link href={`/items/${item.id}`} className="focus-ring rounded-sm flex-1 min-w-0 truncate text-[13px] hover:text-violet-bright">
                  {item.title}
                </Link>
                {chip && (
                  <Chip as="span" className="shrink-0 h-5 px-1.5 text-[11px]">
                    {chip}
                  </Chip>
                )}
                <span className="font-mono text-[11px] text-fg-faint shrink-0">{sinceLabel(item.updatedAt, now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
