"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ToastProvider } from "./toasts";

/** The frame every page sits in: sidebar, breadcrumb bar, rail slot, toasts. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="min-h-screen grid grid-cols-[auto_1fr_auto]">
        <Sidebar drawer={drawer} onClose={() => setDrawer(false)} pathname={pathname} />
        <div className="relative flex flex-col min-w-0 min-h-screen">
          <TopBar onMenu={() => setDrawer(true)} onRail={() => setRailOpen((v) => !v)} />
          <main className="flex-1 min-w-0 pb-28">{children}</main>
        </div>
        <div
          id="rail-slot"
          className={`w-[280px] border-l border-hairline bg-layer-1 max-[1179px]:fixed max-[1179px]:right-0 max-[1179px]:top-12 max-[1179px]:bottom-0 max-[1179px]:z-30 ${railOpen ? "" : "max-[1179px]:hidden"}`}
        />
      </div>
    </ToastProvider>
  );
}
