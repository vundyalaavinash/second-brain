"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ItemDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { StatusBadge, TypeBadge } from "./badges";

export function RecentCaptures({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ItemDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const res = await fetch("/api/items?limit=10", { cache: "no-store" });
        if (!res.ok) throw new Error(res.statusText);
        const data = (await res.json()) as ItemDTO[];
        if (cancelled) return;
        setItems(data);
        const active = data.some((i) => i.status === "pending" || i.status === "processing");
        timer = setTimeout(load, active ? 1500 : 8000);
      } catch {
        if (!cancelled) timer = setTimeout(load, 8000);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="font-mono text-[10px] tracking-wider uppercase text-fg-faint mb-2">Recent</h2>
      <ul className="border border-line rounded-lg divide-y divide-line bg-surface-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 h-9 hover:bg-surface-2 transition-colors duration-150">
            <TypeBadge type={item.type} />
            <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13px] hover:text-accent">
              {item.title}
            </Link>
            <StatusBadge status={item.status} error={item.error} />
            <span className="font-mono text-[10px] text-fg-faint w-16 text-right">{relativeTime(item.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
