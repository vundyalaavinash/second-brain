import Link from "next/link";
import { Archive } from "lucide-react";
import { getDb } from "@/db/client";
import { listContainers } from "@/domain/containers";
import { listItems } from "@/domain/items";
import { serializeContainers, serializeItem } from "@/lib/api";
import { KindIcon, TypeIcon } from "@/components/type-icon";
import { RestoreButton } from "@/components/restore-button";
import { formatDate } from "@/lib/format";
import { EmptyState, List, PageHeader, Row, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  const db = getDb();
  const containers = serializeContainers(db, listContainers(db, { status: "archived" }));
  const items = listItems(db, { onlyArchived: true, limit: 500 }).map((i) => serializeItem(db, i));
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-6">
      <PageHeader
        title="Archive"
        meta={
          <>
            <span className="font-mono">{containers.length}</span> containers and <span className="font-mono">{items.length}</span> items archived.
          </>
        }
      />
      <section className="flex flex-col gap-2">
        <SectionHeading count={containers.length}>Containers</SectionHeading>
        {containers.length === 0 ? (
          <EmptyState icon={Archive} text="No archived containers." />
        ) : (
          <List>
            {containers.map((c) => (
              <Row key={c.id}>
                <KindIcon kind={c.kind} />
                <Link href={`/c/${c.slug}`} className="flex-1 truncate text-[13.5px] hover:text-accent">
                  {c.name}
                </Link>
                <span className="font-mono text-[11px] text-fg-faint">{c.archivedAt ? formatDate(c.archivedAt) : ""}</span>
                <RestoreButton kind="container" id={c.id} />
              </Row>
            ))}
          </List>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <SectionHeading count={items.length}>Items</SectionHeading>
        {items.length === 0 ? (
          <EmptyState icon={Archive} text="No archived items." />
        ) : (
          <List>
            {items.map((i) => (
              <Row key={i.id}>
                <TypeIcon type={i.type} />
                <Link href={`/items/${i.id}`} className="flex-1 truncate text-[13.5px] hover:text-accent">
                  {i.title}
                </Link>
                {i.container && <span className="text-[12px] text-fg-faint truncate max-w-[10rem]">{i.container.name}</span>}
                <span className="font-mono text-[11px] text-fg-faint">{i.archivedAt ? formatDate(i.archivedAt) : ""}</span>
                <RestoreButton kind="item" id={i.id} />
              </Row>
            ))}
          </List>
        )}
      </section>
    </div>
  );
}
