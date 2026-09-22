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

export function SidebarTags({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [tags, setTags] = useState<TagCount[]>([]);

  // Capturing an item is what mints new tags, so the inbox event covers it; `pathname`
  // refreshes the list on the next navigation after an edit.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/tags?counts=1", { cache: "no-store" });
        if (res.ok && alive) setTags(normalise(await res.json()));
      } catch {
        /* offline: keep whatever is on screen */
      }
    }
    void load();
    window.addEventListener("sb:inbox-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("sb:inbox-changed", load);
    };
  }, [pathname]);

  return (
    <section className="flex flex-col gap-2 px-3 pt-4">
      <span className="micro">Tags</span>
      {tags.length === 0 ? (
        <p className="text-[12.5px] text-fg-faint m-0">No tags yet</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, MAX_TAGS).map((t) => (
            <Chip key={t.name} href={`/search?tag=${encodeURIComponent(t.name)}`} onClick={onNavigate}>
              {t.name}
              {t.count > 0 && <span className="font-mono text-[10.5px] text-fg-faint">{t.count}</span>}
            </Chip>
          ))}
        </div>
      )}
      <Link href="/library" onClick={onNavigate} className="focus-ring rounded-sm text-[12.5px] text-fg-muted hover:text-fg">
        All tags
      </Link>
    </section>
  );
}
