import { useEffect, useState } from "react";

export type DrawerTab = "inbox" | "due" | "projects" | "areas" | "search";
export const TAB_KEY = "sb:planner-source-tab";
const TABS: DrawerTab[] = ["inbox", "due", "projects", "areas", "search"];

function stored(): DrawerTab | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.includes(v as DrawerTab) ? (v as DrawerTab) : null;
  } catch {
    return null;
  }
}

/**
 * The active tab: the browser's remembered one once it has been read, else the fallback the
 * day suggests. Reading storage happens in an effect so the server and the first client
 * render agree, and the async setState keeps the react-compiler rule happy.
 */
export function useDrawerTab(fallback: DrawerTab): [DrawerTab, (tab: DrawerTab) => void] {
  const [tab, setTabState] = useState<DrawerTab>(fallback);
  useEffect(() => {
    const remembered = stored();
    if (remembered) queueMicrotask(() => setTabState(remembered));
  }, []);
  function setTab(next: DrawerTab) {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* private mode: the tab just resets next time */
    }
  }
  return [tab, setTab];
}
