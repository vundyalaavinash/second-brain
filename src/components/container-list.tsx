import Link from "next/link";
import type { ContainerDTO } from "@/lib/dto";
import type { ContainerKind } from "@/db/enums";
import { formatDate } from "@/lib/format";
import { EmptyState, List, Row } from "./ui";
import { KindIcon, KIND_ICON } from "./type-icon";

export function ContainerList({ containers, kind, emptyText }: { containers: ContainerDTO[]; kind: ContainerKind; emptyText: string }) {
  if (containers.length === 0) return <EmptyState icon={KIND_ICON[kind]} text={emptyText} />;
  return (
    <List>
      {containers.map((c) => (
        <Row key={c.id}>
          <KindIcon kind={c.kind} />
          <Link href={`/c/${c.slug}`} className="flex-1 min-w-0">
            <div className="truncate text-[13.5px]">{c.name}</div>
            {(c.goal || c.standard || c.description) && (
              <div className="truncate text-[12px] text-fg-muted">{c.goal || c.standard || c.description}</div>
            )}
          </Link>
          {c.kind === "project" && c.deadline && (
            <span className={`text-[11.5px] ${c.deadline < new Date().toISOString().slice(0, 10) ? "text-danger" : "text-fg-muted"}`}>
              Due {formatDate(`${c.deadline}T00:00:00`)}
            </span>
          )}
          <span className="font-mono text-[11px] text-fg-faint w-16 text-right">{c.itemCount} items</span>
        </Row>
      ))}
    </List>
  );
}
