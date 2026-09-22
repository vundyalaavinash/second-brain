"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelRight } from "lucide-react";
import { crumbsFor, type Crumb } from "@/lib/breadcrumb";
import { IconButton } from "../ui";

function isParent(crumb: Crumb): crumb is Crumb & { href: string } {
  return crumb.href !== undefined;
}

export function TopBar({ onRail, railOpen }: { onRail(): void; railOpen: boolean }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  const trail = crumbs.filter(isParent);
  const tail = crumbs.find((c) => !isParent(c));
  return (
    <div className="flex items-center gap-2 h-12 px-4 border-b border-hairline shrink-0">
      <Link href="/" aria-label="Second brain home" className="focus-ring flex items-center gap-2 rounded-sm pr-3 mr-1 border-r border-hairline shrink-0">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="shrink-0">
          <circle cx="10" cy="10" r="10" fill="var(--color-violet)" />
          <circle cx="10" cy="10" r="4" fill="var(--color-carbon)" />
        </svg>
        <span className="font-doc text-[16px] font-medium leading-none text-fg">Second brain</span>
      </Link>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] min-w-0">
        <span className="crumb-trail flex items-center gap-2 min-w-0 empty:hidden">
          {trail.map((c, i) => (
            <span key={c.href} className="flex items-center gap-2">
              {i > 0 && <span className="text-fg-faint">/</span>}
              <Link href={c.href} className="focus-ring text-fg-muted hover:text-fg rounded-sm">
                {c.label}
              </Link>
            </span>
          ))}
        </span>
        <span id="crumb-slot" className="flex items-center gap-2 min-w-0 empty:hidden" />
        {tail && <span className="text-fg crumb-fallback">{tail.label}</span>}
      </nav>
      <span className="flex-1" />
      <IconButton label="Context" icon={PanelRight} onClick={onRail} aria-expanded={railOpen} className="min-[1180px]:hidden rail-toggle" />
    </div>
  );
}
