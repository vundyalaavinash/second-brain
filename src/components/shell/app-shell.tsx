"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ToastProvider } from "./toasts";
import { PromptBar } from "./prompt-bar";

/** The frame every page sits in: sidebar, breadcrumb bar, rail slot, toasts. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  // Below 1180 px the rail is an overlay, so Escape has to dismiss it like any other one.
  useEffect(() => {
    if (!railOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRailOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);

  return (
    <ToastProvider>
      {/* Every child is placed by hand. Auto-placement would put the main column in the
        * leading `auto` track whenever the sidebar (drawer closed) or the rail slot is
        * `display:none`, and it would then size to max-content instead of filling the row. */}
      <div className="min-h-screen grid grid-cols-[auto_1fr_auto]">
        <Sidebar drawer={drawer} onClose={() => setDrawer(false)} pathname={pathname} />
        <div className="col-start-2 relative flex flex-col min-w-0 min-h-screen">
          <TopBar onMenu={() => setDrawer(true)} onRail={() => setRailOpen((v) => !v)} railOpen={railOpen} />
          <main className="flex-1 min-w-0 pb-28">{children}</main>
          {/* Sticky, not fixed: it stays over the page but keeps the main column's width,
            * so it never reaches across the sidebar. `main`'s padding leaves it room. */}
          <div className="sticky bottom-4 px-4 z-20">
            <PromptBar />
          </div>
        </div>
        {railOpen && (
          <button
            type="button"
            aria-label="Close context"
            onClick={() => setRailOpen(false)}
            className="focus-ring fixed inset-0 z-20 bg-black/50 min-[1180px]:hidden"
          />
        )}
        {/* Wide: its own column, pinned under the top bar so it scrolls on its own rather
          * than with the page. Narrow: an overlay over the main column. */}
        <div
          id="rail-slot"
          className={`col-start-3 w-[280px] border-l border-hairline bg-layer-1 min-[1180px]:sticky min-[1180px]:top-12 min-[1180px]:h-[calc(100vh-3rem)] min-[1180px]:self-start min-[1180px]:overflow-hidden max-[1179px]:fixed max-[1179px]:right-0 max-[1179px]:top-12 max-[1179px]:bottom-0 max-[1179px]:z-30 ${railOpen ? "" : "max-[1179px]:hidden"}`}
        />
      </div>
    </ToastProvider>
  );
}
