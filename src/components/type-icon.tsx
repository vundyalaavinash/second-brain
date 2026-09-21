import { FileText, Link2, File, Mic, BookOpen, ClipboardCheck, Flag, Layers, BookMarked, type LucideIcon } from "lucide-react";
import type { ContainerKind, ItemStatus, ItemType } from "@/db/enums";

const TYPE_ICON: Record<ItemType, LucideIcon> = {
  note: FileText,
  link: Link2,
  file: File,
  meeting: Mic,
  journal: BookOpen,
  review: ClipboardCheck,
};

export const TYPE_LABEL: Record<ItemType, string> = {
  note: "Note",
  link: "Link",
  file: "File",
  meeting: "Meeting",
  journal: "Journal",
  review: "Review",
};

export const KIND_ICON: Record<ContainerKind, LucideIcon> = { project: Flag, area: Layers, resource: BookMarked };
export const KIND_LABEL: Record<ContainerKind, string> = { project: "Project", area: "Area", resource: "Resource" };

export function TypeIcon({ type, className = "w-4 h-4 text-fg-muted shrink-0" }: { type: ItemType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return <Icon className={className} role="img" aria-label={TYPE_LABEL[type]} />;
}

export function KindIcon({ kind, className = "w-4 h-4 text-fg-muted shrink-0" }: { kind: ContainerKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={className} role="img" aria-label={KIND_LABEL[kind]} />;
}

const STATUS: Record<ItemStatus, { dot: string; label: string; text: string }> = {
  pending: { dot: "bg-fg-faint", label: "queued", text: "text-fg-faint" },
  processing: { dot: "bg-brass live-dot", label: "processing", text: "text-brass" },
  ready: { dot: "bg-success", label: "ready", text: "text-fg-faint" },
  failed: { dot: "bg-danger", label: "failed", text: "text-danger" },
};

export function StatusDot({ status, error }: { status: ItemStatus; error?: string | null }) {
  const s = STATUS[status];
  return (
    <span title={error ?? undefined} className={`inline-flex items-center gap-1.5 text-[11.5px] ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
