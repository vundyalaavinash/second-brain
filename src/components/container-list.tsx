import Link from "next/link";
import type { ContainerDTO } from "@/lib/dto";
import { formatDate } from "@/lib/format";

export function ContainerList({ containers, emptyText }: { containers: ContainerDTO[]; emptyText: string }) {
  if (containers.length === 0) return <div className="px-3 h-12 flex items-center text-fg-faint text-[13px] border border-line rounded-lg bg-surface-1">{emptyText}</div>;
  return (
    <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
      {containers.map((c) => (
        <li key={c.id} className="flex items-center gap-3 px-3 h-11 hover:bg-surface-2 transition-colors duration-150">
          <Link href={`/c/${c.slug}`} className="flex-1 min-w-0">
            <div className="truncate text-[13.5px]">{c.name}</div>
            {(c.goal || c.standard || c.description) && (
              <div className="truncate text-[11.5px] text-fg-muted">{c.goal || c.standard || c.description}</div>
            )}
          </Link>
          {c.kind === "project" && c.deadline && (
            <span className={`font-mono text-[10px] ${c.deadline < new Date().toISOString().slice(0, 10) ? "text-danger" : "text-fg-muted"}`}>
              due {formatDate(`${c.deadline}T00:00:00`)}
            </span>
          )}
          <span className="font-mono text-[10px] text-fg-faint w-14 text-right">{c.itemCount} items</span>
        </li>
      ))}
    </ul>
  );
}
