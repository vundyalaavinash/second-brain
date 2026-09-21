"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, Plus } from "lucide-react";
import { NAV_ITEMS, CAPTURE_ITEM } from "../nav";
import { Icon } from "../icons";
import { DockItem } from "./dock-item";
import { DockMore } from "./dock-more";
import type { HelperStateDTO } from "@/lib/dto";

const POLL_MS = 20_000;
const ACTIVITY_POLL_MS = 60_000;
const HELPER_STALE_MS = 120_000;

const NARROW_QUERY = "(max-width: 719px)";

function subscribeNarrow(callback: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getNarrowSnapshot(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

function getNarrowServerSnapshot(): boolean {
  return false;
}

function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getNarrowServerSnapshot);
}

const PARA_ITEMS = NAV_ITEMS.filter((n) => n.group === "para");
const TOOLS_ITEMS = NAV_ITEMS.filter((n) => n.group === "tools");
const NARROW_HREFS = new Set(["/inbox", "/projects", "/search"]);
const NARROW_MORE_ITEMS = NAV_ITEMS.filter((n) => !NARROW_HREFS.has(n.href));

export function Dock() {
  const pathname = usePathname();
  const narrow = useNarrow();
  const [inboxCount, setInboxCount] = useState(0);
  const [helperDown, setHelperDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox?limit=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (!cancelled) setInboxCount(data.count);
      } catch {
        /* offline */
      }
    }
    void load();
    const id = setInterval(load, POLL_MS);
    window.addEventListener("sb:inbox-changed", load);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("sb:inbox-changed", load);
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/activity/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { helper: HelperStateDTO; paused: boolean };
        if (cancelled) return;
        setHelperDown(!data.paused && (!data.helper.lastSeen || Date.now() - Date.parse(data.helper.lastSeen) > HELPER_STALE_MS));
      } catch {
        /* offline */
      }
    }
    void load();
    const id = setInterval(load, ACTIVITY_POLL_MS);
    window.addEventListener("sb:activity-changed", load);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("sb:activity-changed", load);
    };
  }, [pathname]);

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderItem(item: (typeof NAV_ITEMS)[number]) {
    const badge = item.badge === "inbox" && inboxCount > 0 ? inboxCount : undefined;
    const dot = item.badge === "activity" && helperDown;
    return (
      <DockItem key={item.href} href={item.href} label={item.label} shortcut={item.shortcut} active={isActive(item.href)} badge={badge} dot={dot}>
        <Icon name={item.icon} />
      </DockItem>
    );
  }

  const captureItem = (
    <>
      <li>
        <Link
          href={CAPTURE_ITEM.href}
          aria-label="Capture"
          className="focus-ring group relative flex items-center justify-center w-10 h-10 rounded-full bg-brass text-brass-ink shadow-[0_6px_16px_-6px_rgba(224,169,60,.7)] motion-safe:active:scale-[0.96]"
        >
          <Plus className="w-5 h-5" strokeWidth={2} aria-hidden />
          <span
            role="tooltip"
            className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap panel rounded-md px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0"
          >
            Capture
            <span className="kbd ml-2">g c</span>
          </span>
        </Link>
      </li>
    </>
  );

  if (narrow) {
    const inbox = NAV_ITEMS.find((n) => n.href === "/inbox")!;
    const projects = NAV_ITEMS.find((n) => n.href === "/projects")!;
    const search = NAV_ITEMS.find((n) => n.href === "/search")!;
    return (
      <nav aria-label="Main" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
        <ul className="panel flex items-center gap-1 px-2 h-14 rounded-full">
          {renderItem(inbox)}
          {renderItem(projects)}
          {renderItem(search)}
          <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
          {captureItem}
          <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
          <DockMore items={NARROW_MORE_ITEMS} pathname={pathname} />
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <ul className="panel flex items-center gap-1 px-2 h-14 rounded-full">
        {PARA_ITEMS.map(renderItem)}
        <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
        {TOOLS_ITEMS.map(renderItem)}
        <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
        {captureItem}
        <li className="w-px h-6 bg-hairline-strong mx-1" aria-hidden />
        <li>
          <button
            type="button"
            aria-label="Command palette"
            onClick={() => window.dispatchEvent(new Event("sb:palette"))}
            className="focus-ring group relative flex items-center justify-center w-11 h-11 rounded-full text-fg-muted hover:text-fg hover:bg-slate-2 transition-colors duration-150"
          >
            <Command className="w-5 h-5" strokeWidth={1.75} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap panel rounded-md px-2.5 py-1 text-[12px] text-fg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0"
            >
              Commands
              <span className="kbd ml-2">⌘K</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
