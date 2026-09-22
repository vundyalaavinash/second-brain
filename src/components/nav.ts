export type IconName = "today" | "inbox" | "project" | "area" | "resource" | "people" | "activity" | "library" | "archive" | "search" | "capture";

export interface NavItem {
  href: string;
  label: string;
  shortcut: string;
  icon: IconName;
  badge?: "inbox" | "activity";
  section: "brain" | "tools";
  /** Container kind whose active containers appear as a disclosure under this row. */
  tree?: "project" | "area";
}

/** Order is the sidebar order. Every entry has a `g` + letter shortcut. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", shortcut: "g d", icon: "today", section: "brain" },
  { href: "/inbox", label: "Inbox", shortcut: "g i", icon: "inbox", badge: "inbox", section: "brain" },
  { href: "/projects", label: "Projects", shortcut: "g p", icon: "project", section: "brain", tree: "project" },
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area", section: "brain", tree: "area" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource", section: "brain" },
  { href: "/people", label: "People", shortcut: "g e", icon: "people", section: "brain" },
  { href: "/activity", label: "Activity", shortcut: "g t", icon: "activity", badge: "activity", section: "tools" },
  { href: "/library", label: "Library", shortcut: "g l", icon: "library", section: "tools" },
  { href: "/archive", label: "Archive", shortcut: "g x", icon: "archive", section: "tools" },
];

/** Search and Capture are not sidebar rows (the search button and the prompt bar cover them) but keep their shortcuts and palette entries. */
export const SEARCH_ITEM: NavItem = { href: "/search", label: "Search", shortcut: "g s", icon: "search", section: "tools" };
export const CAPTURE_ITEM: NavItem = { href: "/capture", label: "Capture", shortcut: "g c", icon: "capture", section: "tools" };
