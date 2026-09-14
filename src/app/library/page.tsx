import Link from "next/link";
import { Search } from "lucide-react";
import { getDb } from "@/db/client";
import { ITEM_STATUSES, ITEM_TYPES, type ItemStatus, type ItemType } from "@/db/enums";
import { listItems, listTagNames } from "@/domain/items";
import { listContainers } from "@/domain/containers";
import { TypeIcon, StatusDot, TYPE_LABEL, KIND_LABEL } from "@/components/type-icon";
import { relativeTime, titleCase } from "@/lib/format";
import { Button, Chip, EmptyState, Input, List, PageHeader, Row, Select } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { type?: string; status?: string; tag?: string; from?: string; to?: string; container?: string; archived?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isType(v: string | undefined): v is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(v ?? "");
}
function isStatus(v: string | undefined): v is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(v ?? "");
}
function isDate(v: string | undefined): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}
/** `container=<id>` → id, `container=inbox` → null, absent/invalid → undefined. Mirrors parseContainerParam in lib/api. */
function parseContainer(v: string | undefined): number | null | undefined {
  if (!v) return undefined;
  if (v === "inbox") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const type = isType(sp.type) ? sp.type : undefined;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const tag = sp.tag || undefined;
  const from = isDate(sp.from) ? sp.from : undefined;
  const to = isDate(sp.to) ? sp.to : undefined;
  const containerId = parseContainer(sp.container);
  const archived = sp.archived === "1";
  const db = getDb();
  const items = listItems(db, { type, status, tag, from, to, containerId, includeArchived: archived, limit: 200 });
  const tags = listTagNames(db);
  const containers = listContainers(db, { status: "active" });

  const href = (patch: Partial<SP>) => {
    const merged: SP = { ...sp, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/library${s ? `?${s}` : ""}`;
  };
  return (
    <div className="w-full max-w-4xl mx-auto px-6 pt-8 flex flex-col gap-5">
      <PageHeader title="Library" meta={<span className="font-mono">{items.length} shown</span>} />

      <div className="flex flex-wrap gap-2 items-center">
        <Chip href={href({ type: undefined })} active={!type}>
          All
        </Chip>
        {ITEM_TYPES.map((t) => (
          <Chip key={t} href={href({ type: t })} active={type === t}>
            {TYPE_LABEL[t]}
          </Chip>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {ITEM_STATUSES.map((s) => (
          <Chip key={s} href={href({ status: status === s ? undefined : s })} active={status === s}>
            {titleCase(s)}
          </Chip>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {tags.map((t) => (
            <Chip key={t} href={href({ tag: tag === t ? undefined : t })} active={tag === t}>
              #{t}
            </Chip>
          ))}
        </div>
      )}

      <form action="/library" className="flex flex-wrap gap-2 items-center">
        {type && <input type="hidden" name="type" value={type} />}
        {status && <input type="hidden" name="status" value={status} />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <div className="w-56">
          <Select name="container" defaultValue={sp.container ?? ""} size="sm" className="w-full">
            <option value="">Any home</option>
            <option value="inbox">Inbox</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({KIND_LABEL[c.kind]})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Input type="date" name="from" defaultValue={from ?? ""} size="sm" className="w-full" />
        </div>
        <span className="text-[12px] text-fg-faint">to</span>
        <div className="w-36">
          <Input type="date" name="to" defaultValue={to ?? ""} size="sm" className="w-full" />
        </div>
        <label className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-line text-[12px] text-fg-muted hover:text-fg cursor-pointer">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} className="accent-accent" />
          Include archived
        </label>
        <Button variant="secondary" size="sm" type="submit">
          Apply
        </Button>
        {(from || to || sp.container || archived) && (
          <Link
            href={href({ from: undefined, to: undefined, container: undefined, archived: undefined })}
            className="text-[12.5px] text-fg-faint hover:text-fg underline"
          >
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <EmptyState icon={Search} text="Nothing here yet." />
      ) : (
        <List>
          {items.map((item) => (
            <Row key={item.id}>
              <span className="font-mono text-[11px] text-fg-faint w-8">#{item.id}</span>
              <TypeIcon type={item.type} />
              <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13.5px] hover:text-accent">
                {item.title}
              </Link>
              <StatusDot status={item.status} error={item.error} />
              <span className="font-mono text-[11px] text-fg-faint w-16 text-right">{relativeTime(item.createdAt)}</span>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
}
