export type IconName = "inbox" | "project" | "area" | "resource" | "people" | "library" | "archive" | "search" | "capture";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: IconName;
  badge?: "inbox";
}

/** Order is the dock order. Every entry has a `g` + letter shortcut. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", shortcut: "g i", icon: "inbox", badge: "inbox" },
  { href: "/projects", label: "Projects", shortcut: "g p", icon: "project" },
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource" },
  { href: "/people", label: "People", shortcut: "g e", icon: "people" },
  { href: "/library", label: "Library", shortcut: "g l", icon: "library" },
  { href: "/archive", label: "Archive", shortcut: "g x", icon: "archive" },
  { href: "/search", label: "Search", shortcut: "g s", icon: "search" },
  { href: "/capture", label: "Capture", shortcut: "g c", icon: "capture" },
];
