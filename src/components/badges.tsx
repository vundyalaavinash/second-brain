import type { ItemStatus, ItemType } from "@/db/enums";
import { StatusDot, TypeIcon, TYPE_LABEL } from "./type-icon";

/** Compatibility wrapper; new code should use TypeIcon directly. */
export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
      <TypeIcon type={type} className="w-3.5 h-3.5" />
      {TYPE_LABEL[type]}
    </span>
  );
}

export function StatusBadge(props: { status: ItemStatus; error?: string | null }) {
  return <StatusDot {...props} />;
}
