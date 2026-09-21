export type IconName = "inbox" | "project" | "area" | "resource" | "people" | "activity" | "library" | "archive" | "search" | "capture";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: IconName;
  badge?: "inbox" | "activity";
  group: "para" | "tools";
}

/** Order is the dock order. Every entry has a `g` + letter shortcut. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", shortcut: "g i", icon: "inbox", badge: "inbox", group: "para" },
  { href: "/projects", label: "Projects", shortcut: "g p", icon: "project", group: "para" },
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area", group: "para" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource", group: "para" },
  { href: "/people", label: "People", shortcut: "g e", icon: "people", group: "para" },
  { href: "/activity", label: "Activity", shortcut: "g t", icon: "activity", badge: "activity", group: "tools" },
  { href: "/library", label: "Library", shortcut: "g l", icon: "library", group: "tools" },
  { href: "/archive", label: "Archive", shortcut: "g x", icon: "archive", group: "tools" },
  { href: "/search", label: "Search", shortcut: "g s", icon: "search", group: "tools" },
];

/** Capture is rendered by the dock itself (its own raised button), not iterated as a nav item,
 * but it keeps the same `g` shortcut and command-palette entry as every other destination. */
export const CAPTURE_ITEM: NavItem = { href: "/capture", label: "Capture", shortcut: "g c", icon: "capture", group: "tools" };
