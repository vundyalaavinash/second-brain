import { SectionHeading, List, Row } from "../ui";
import { formatDuration } from "./format";
import type { ActivityDayDTO } from "@/lib/dto";

interface Entry {
  key: string;
  label: string;
  ms: number;
  color?: string;
}

function Column({ heading, entries }: { heading: string; entries: Entry[] }) {
  const top = entries.slice(0, 10);
  const max = Math.max(1, ...top.map((e) => e.ms));
  return (
    <div>
      <SectionHeading>{heading}</SectionHeading>
      {top.length === 0 ? (
        <p className="text-fg-faint text-[13px]">Nothing yet.</p>
      ) : (
        <List>
          {top.map((e) => (
            <Row key={e.key}>
              <span className="flex-1 min-w-0 truncate text-[13px]">{e.label}</span>
              <span className="w-16 h-1 rounded-full bg-line shrink-0 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(e.ms / max) * 100}%`, backgroundColor: e.color ?? "var(--color-accent-dim)" }}
                />
              </span>
              <span className="font-mono text-[11px] text-fg-faint shrink-0">{formatDuration(e.ms)}</span>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
}

export function Totals({ data }: { data: ActivityDayDTO }) {
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));

  const byCategory: Entry[] = data.byCategory.map((e) => {
    const category = e.categoryId !== null ? categoryById.get(e.categoryId) : undefined;
    return { key: String(e.categoryId ?? "none"), label: category?.name ?? "Uncategorized", ms: e.ms, color: category?.color };
  });
  const byApp: Entry[] = data.byApp.map((e) => ({ key: e.appId ?? "unknown", label: e.appName ?? e.appId ?? "Unknown", ms: e.ms }));
  const bySite: Entry[] = data.bySite.map((e) => ({ key: e.key, label: e.label, ms: e.ms }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Column heading="By category" entries={byCategory} />
      <Column heading="By app" entries={byApp} />
      <Column heading="By site or window" entries={bySite} />
    </div>
  );
}
