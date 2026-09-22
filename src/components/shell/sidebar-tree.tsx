"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ContainerDTO } from "@/lib/dto";
import { ProgressRing } from "../tasks/progress-ring";
import { setStored, useStored } from "./use-stored";

const KEY = "sb.sidebar.open";

/** A stored `"null"`, an array, or anything unparseable reads as "nothing is open". */
function parseOpen(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** The disclosure under a Projects or Areas row: its active containers, one link each. */
export function SidebarTree({
  kind,
  label,
  pathname,
  onNavigate,
}: {
  kind: "project" | "area";
  label: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const raw = useStored(KEY);
  const open = parseOpen(raw)[kind] === true;
  const [items, setItems] = useState<ContainerDTO[] | null>(null);

  // `pathname` is a dependency so that creating, renaming, or archiving a container is
  // picked up on the next navigation, not only when something dispatches the event.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/containers?kind=${kind}&status=active`, { cache: "no-store" });
        if (res.ok && alive) setItems((await res.json()) as ContainerDTO[]);
      } catch {
        /* keep previous list */
      }
    }
    void load();
    window.addEventListener("sb:containers-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("sb:containers-changed", load);
    };
  }, [open, kind, pathname]);

  function toggle() {
    setStored(KEY, JSON.stringify({ ...parseOpen(raw), [kind]: !open }));
  }

  return (
    <div>
      {/* The row wrapper is `relative` and 36 px tall, so a fixed 6 px offset keeps the
       * chevron on the row once the list below it opens. */}
      <button
        type="button"
        aria-label={`Show ${label.toLowerCase()}`}
        aria-expanded={open}
        onClick={toggle}
        className="focus-ring absolute right-2 top-1.5 w-6 h-6 rounded-sm flex items-center justify-center text-fg-faint hover:text-fg hover:bg-layer-2"
      >
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {open && items && (
        <ul className="list-none m-0 p-0 pl-7 pb-1">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/c/${c.slug}`}
                aria-current={pathname === `/c/${c.slug}` ? "page" : undefined}
                onClick={onNavigate}
                className={`focus-ring flex items-center gap-2 h-8 px-2 rounded-sm text-[13px] truncate ${pathname === `/c/${c.slug}` ? "text-fg bg-layer-3" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`}
              >
                {kind === "project" && <ProgressRing percent={c.progress.percent} size={14} />}
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          ))}
          {items.length === 0 && <li className="px-2 h-8 flex items-center text-[12.5px] text-fg-faint">None active</li>}
        </ul>
      )}
    </div>
  );
}
