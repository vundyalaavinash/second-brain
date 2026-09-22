import type { ActivityCategoryDTO } from "@/lib/dto";

export const AFK_COLOR = "var(--color-layer-3)";

interface Props {
  categories: ActivityCategoryDTO[];
}

/** The category colour key shown under both the day timeline and the week chart. */
export function Legend({ categories }: Props) {
  return (
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
  );
}
