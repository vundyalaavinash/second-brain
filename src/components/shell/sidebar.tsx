"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { NAV_ITEMS, type NavItem } from "../nav";
import { Icon } from "../icons";
import { IconButton } from "../ui";
import { SidebarTree } from "./sidebar-tree";
import { SidebarTags } from "./sidebar-tags";
import type { HelperStateDTO } from "@/lib/dto";

const POLL_MS = 20_000;
const ACTIVITY_POLL_MS = 60_000;
const HELPER_STALE_MS = 120_000;

const COLLAPSED_KEY = "sb.sidebar.collapsed";

const BRAIN_ITEMS = NAV_ITEMS.filter((n) => n.section === "brain");
const TOOLS_ITEMS = NAV_ITEMS.filter((n) => n.section === "tools");

export function Sidebar({ drawer, onClose, pathname }: { drawer: boolean; onClose(): void; pathname: string }) {
  const [inboxCount, setInboxCount] = useState(0);
  const [helperDown, setHelperDown] = useState(false);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Persisted width is read after mount so the server and the first client render agree.
  useEffect(() => {
    try {
      // localStorage is unreadable on the server, so reading it during render would
      // break hydration. Runs once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      /* private mode */
    }
  }, []);

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
        setPaused(data.paused);
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

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function renderRow(item: NavItem) {
    const badge = item.badge === "inbox" && inboxCount > 0 ? inboxCount : undefined;
    const dot = item.badge === "activity" && helperDown;
    const active = isActive(item.href);
    return (
      <li key={item.href} className="relative">
        <Link
          href={item.href}
          aria-label={[item.label, badge ? `${badge} waiting` : null, dot ? "not recording" : null].filter(Boolean).join(", ")}
          aria-current={active ? "page" : undefined}
          title={collapsed ? item.label : undefined}
          className={`focus-ring relative flex items-center gap-2.5 h-9 rounded-sm text-[13px] transition-colors duration-150 ${
            collapsed ? "justify-center px-0" : item.tree ? "pl-2.5 pr-8" : "px-2.5"
          } ${active ? "bg-layer-3 text-fg" : "text-fg-muted hover:text-fg hover:bg-layer-2"}`}
        >
          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-violet" aria-hidden />}
          <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {badge ? (
            <span className="min-w-4 h-4 px-1 rounded-full bg-violet text-on-violet font-mono text-[10px] leading-4 text-center shrink-0">
              {badge > 99 ? "99+" : badge}
            </span>
          ) : null}
          {dot && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-hidden />}
        </Link>
        {item.tree && !collapsed && <SidebarTree kind={item.tree} label={item.label} href={item.href} pathname={pathname} />}
      </li>
    );
  }

  const status = paused ? "Paused" : helperDown ? "Not recording" : "Recording";
  const statusDot = paused ? "bg-warn" : helperDown ? "bg-danger" : "bg-success live-dot";

  return (
    <>
      {drawer && (
        <button type="button" aria-label="Close menu" onClick={onClose} className="focus-ring fixed inset-0 z-30 bg-black/50 min-[900px]:hidden" />
      )}
      <div
        className={`${drawer ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-[264px] flex-col bg-layer-1 border-r border-hairline min-[900px]:flex min-[900px]:sticky min-[900px]:top-0 min-[900px]:bottom-auto min-[900px]:left-auto min-[900px]:z-auto min-[900px]:h-screen ${
          collapsed ? "min-[900px]:w-16" : "min-[900px]:w-[264px]"
        }`}
      >
        <div className={`flex shrink-0 ${collapsed ? "flex-col items-center gap-1 py-2" : "items-center gap-2 h-12 px-3"}`}>
          <Link href="/" aria-label="Second brain" title="Second brain" className="focus-ring rounded-sm inline-flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
              <circle cx="10" cy="10" r="10" fill="var(--color-violet)" />
              <circle cx="10" cy="10" r="4" fill="var(--color-carbon)" />
            </svg>
            {!collapsed && <span className="text-[13px] font-medium">Second brain</span>}
          </Link>
          {!collapsed && <span className="flex-1" />}
          <IconButton label="Search" icon={Search} onClick={() => window.dispatchEvent(new Event("sb:palette"))} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <nav aria-label="Main" className={collapsed ? "px-2" : "px-3"}>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">{BRAIN_ITEMS.map(renderRow)}</ul>
            <hr className="border-0 border-t border-hairline my-2" />
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">{TOOLS_ITEMS.map(renderRow)}</ul>
          </nav>
          {!collapsed && <SidebarTags />}
        </div>

        <div className={`shrink-0 flex items-center gap-2 border-t border-hairline ${collapsed ? "flex-col py-2 px-2" : "p-3"}`}>
          <Link
            href="/activity"
            aria-label={`Activity, ${status.toLowerCase()}`}
            title={status}
            className={`focus-ring pane flex items-center gap-2 h-9 ${collapsed ? "w-9 justify-center px-0" : "flex-1 px-3"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} aria-hidden />
            {!collapsed && <span className="text-[12.5px] text-fg-muted truncate">{status}</span>}
          </Link>
          <IconButton
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            onClick={toggleCollapsed}
          />
        </div>
      </div>
    </>
  );
}
