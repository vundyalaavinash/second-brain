import type { ItemStatus, ItemType } from "@/db/enums";

const TYPE_LABEL: Record<ItemType, string> = {
  note: "NOTE",
  link: "LINK",
  file: "FILE",
  meeting: "MTG",
  journal: "JRNL",
  review: "REVW",
};

export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className="font-mono text-[10px] tracking-wider text-fg-muted border border-line rounded-sm px-1.5 py-0.5 leading-none">
      {TYPE_LABEL[type]}
    </span>
  );
}

const STATUS: Record<ItemStatus, { dot: string; label: string; text: string }> = {
  pending: { dot: "bg-fg-faint", label: "queued", text: "text-fg-muted" },
  processing: { dot: "bg-accent live-dot", label: "processing", text: "text-accent" },
  ready: { dot: "bg-success", label: "ready", text: "text-fg-muted" },
  failed: { dot: "bg-danger", label: "failed", text: "text-danger" },
};

export function StatusBadge({ status, error }: { status: ItemStatus; error?: string | null }) {
  const s = STATUS[status];
  return (
    <span title={error ?? undefined} className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
