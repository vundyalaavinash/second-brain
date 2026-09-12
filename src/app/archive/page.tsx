import Link from "next/link";
import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { listItems } from "@/domain/items";
import { serializeContainer, serializeItem } from "@/lib/api";
import { TypeBadge } from "@/components/badges";
import { RestoreButton } from "@/components/restore-button";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  const db = getDb();
  const containers = listContainers(db, { status: "archived" }).map((c) => serializeContainer(db, c));
  const items = listItems(db, { onlyArchived: true, limit: 500 }).map((i) => serializeItem(db, i));
  return (
    <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Archive</h1>
        <span className="font-mono text-[10px] text-fg-faint">{containers.length} containers · {items.length} items</span>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Containers</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {containers.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No archived containers.</li>}
          {containers.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 h-10">
              <span className="font-mono text-[10px] tracking-wider uppercase text-fg-muted border border-line rounded-sm px-1.5 py-0.5">{c.kind}</span>
              <Link href={`/c/${c.slug}`} className="flex-1 truncate text-[13px] hover:text-accent">{c.name}</Link>
              <span className="font-mono text-[10px] text-fg-faint">{c.archivedAt ? formatDate(c.archivedAt) : ""}</span>
              <RestoreButton kind="container" id={c.id} />
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint">Items</h2>
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
          {items.length === 0 && <li className="px-3 h-10 flex items-center text-fg-faint text-[13px]">No archived items.</li>}
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 h-10">
              <TypeBadge type={i.type} />
              <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13px] hover:text-accent">{i.title}</Link>
              {i.container && <span className="font-mono text-[10px] text-fg-faint">{i.container.name}</span>}
              <span className="font-mono text-[10px] text-fg-faint">{i.archivedAt ? formatDate(i.archivedAt) : ""}</span>
              <RestoreButton kind="item" id={i.id} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
