"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ItemDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { SectionHeading, List, Row } from "./ui";
import { TypeIcon, StatusDot } from "./type-icon";

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
      <SectionHeading>Recent</SectionHeading>
      <List>
        {items.map((item) => (
          <Row key={item.id}>
            <TypeIcon type={item.type} />
            <Link href={`/items/${item.id}`} className="flex-1 truncate text-[13.5px] hover:text-violet-bright">
              {item.title}
            </Link>
            <StatusDot status={item.status} error={item.error} />
            <span className="font-mono text-[11px] text-fg-faint w-16 text-right">{relativeTime(item.createdAt)}</span>
          </Row>
        ))}
      </List>
    </section>
  );
}
