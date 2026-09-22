"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Chip } from "../ui";

interface TagCount { name: string; count: number }

const MAX_TAGS = 10;

/** Until the counts parameter lands the endpoint answers with plain names, so a string
 * array is read as a zero count. */
function normalise(data: unknown): TagCount[] {
  if (!Array.isArray(data)) return [];
  return data.map((t) => (typeof t === "string" ? { name: t, count: 0 } : (t as TagCount))).filter((t) => typeof t.name === "string");
}

export function SidebarTags() {
  const [tags, setTags] = useState<TagCount[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/tags?counts=1", { cache: "no-store" });
        if (res.ok && alive) setTags(normalise(await res.json()));
      } catch {
        /* offline */
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  if (tags.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 px-3 pt-4">
      <span className="micro">Tags</span>
      <div className="flex flex-wrap gap-1.5">
        {tags.slice(0, MAX_TAGS).map((t) => (
          <Chip key={t.name} href={`/search?tag=${encodeURIComponent(t.name)}`}>
            {t.name}
            {t.count > 0 && <span className="font-mono text-[10.5px] text-fg-faint">{t.count}</span>}
          </Chip>
        ))}
      </div>
      <Link href="/library" className="focus-ring rounded-sm text-[12.5px] text-fg-muted hover:text-fg">
        All tags
      </Link>
    </section>
  );
}
