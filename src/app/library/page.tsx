import Link from "next/link";
import { getDb } from "@/db/client";
import { ITEM_STATUSES, ITEM_TYPES, type ItemStatus, type ItemType } from "@/db/enums";
import { listItems, listTagNames } from "@/domain/items";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type SP = { type?: string; status?: string; tag?: string };

function isType(v: string | undefined): v is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(v ?? "");
}
function isStatus(v: string | undefined): v is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(v ?? "");
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const type = isType(sp.type) ? sp.type : undefined;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const tag = sp.tag || undefined;
  const db = getDb();
  const items = listItems(db, { type, status, tag, limit: 200 });
  const tags = listTagNames(db);

  const href = (patch: Partial<SP>) => {
    const merged: SP = { ...sp, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/library${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    `h-6 px-2 rounded-sm font-mono text-[10px] tracking-wider uppercase border transition-colors duration-150 ${
      active ? "border-accent text-accent bg-accent-dim" : "border-line text-fg-muted hover:text-fg"
    }`;

  return (
    <div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Library</h1>
        <span className="font-mono text-[10px] text-fg-faint">{items.length} shown</span>
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <Link href={href({ type: undefined })} className={chip(!type)}>
          all
        </Link>
        {ITEM_TYPES.map((t) => (
          <Link key={t} href={href({ type: t })} className={chip(type === t)}>
            {t}
          </Link>
        ))}
        <span className="w-px h-4 bg-line mx-1" />
        {ITEM_STATUSES.map((s) => (
          <Link key={s} href={href({ status: status === s ? undefined : s })} className={chip(status === s)}>
            {s}
          </Link>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {tags.map((t) => (
            <Link key={t} href={href({ tag: tag === t ? undefined : t })} className={chip(tag === t)}>
              #{t}
            </Link>
          ))}
        </div>
      )}

      <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
        {items.length === 0 && <li className="px-3 h-12 flex items-center text-fg-faint text-[13px]">Nothing here yet.</li>}
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 h-10 hover:bg-surface-2 transition-colors duration-150">
            <span className="font-mono text-[10px] text-fg-faint w-8">#{item.id}</span>
            <TypeBadge type={item.type} />
            <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13px] hover:text-accent">
              {item.title}
            </Link>
            <StatusBadge status={item.status} error={item.error} />
            <span className="font-mono text-[10px] text-fg-faint w-16 text-right">{relativeTime(item.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
