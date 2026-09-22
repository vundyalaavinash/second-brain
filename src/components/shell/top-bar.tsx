"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelRight } from "lucide-react";
import { crumbsFor } from "@/lib/breadcrumb";
import { IconButton } from "../ui";

export function TopBar({ onMenu, onRail }: { onMenu(): void; onRail(): void }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  const tail = crumbs[crumbs.length - 1];
  return (
    <div className="flex items-center gap-2 h-12 px-4 border-b border-hairline shrink-0">
      <IconButton label="Menu" icon={Menu} onClick={onMenu} className="min-[900px]:hidden" />
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] min-w-0">
        {crumbs.slice(0, -1).map((c) => (
          <span key={c.label} className="flex items-center gap-2">
            {c.href ? (
              <Link href={c.href} className="focus-ring text-fg-muted hover:text-fg rounded-sm">
                {c.label}
              </Link>
            ) : (
              <span className="text-fg-muted">{c.label}</span>
            )}
            <span className="text-fg-faint">/</span>
          </span>
        ))}
        <span id="crumb-slot" className="flex items-center gap-2 min-w-0 empty:hidden" />
        {tail.label && <span className="text-fg crumb-fallback">{tail.label}</span>}
      </nav>
      <span className="flex-1" />
      <IconButton label="Context" icon={PanelRight} onClick={onRail} className="min-[1180px]:hidden rail-toggle" />
    </div>
  );
}
