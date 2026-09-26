export interface Crumb { label: string; href?: string }

const TOP: Record<string, string> = { "/planner": "Planner", "/goals": "Goals", "/inbox": "Inbox", "/projects": "Projects", "/areas": "Areas", "/resources": "Resources", "/people": "People", "/activity": "Activity", "/library": "Library", "/archive": "Archive", "/search": "Search", "/capture": "Capture" };

/**
 * The route's own trail. A crumb with an `href` is a parent the bar links to; one without
 * is the page's own label. A nested route contributes only its parent, because the page
 * supplies the title (and its separator) through `<Crumb>`.
 */
export function crumbsFor(pathname: string): Crumb[] {
  if (TOP[pathname]) return [{ label: TOP[pathname] }];
  // The Planner's views are siblings of the day, so each names it as the parent to go back to.
  if (pathname === "/planner/week") return [{ label: "Planner", href: "/planner" }, { label: "Week" }];
  if (pathname === "/planner/meetings") return [{ label: "Planner", href: "/planner" }, { label: "Meetings" }];
  // Reached from the Meetings view's own link, not the dock or a URL a person would type by
  // hand — the trail still names its way back rather than falling through to "Home".
  if (pathname === "/meetings/audit") return [{ label: "Meetings", href: "/planner/meetings" }, { label: "Audit" }];
  // A container page supplies both halves itself — `<Crumb parent title>` names the kind it
  // belongs to ("Projects", "Areas", "Resources"), so a trail here would repeat the parent.
  if (pathname.startsWith("/c/")) return [];
  // Home names itself through `<Crumb title="Home">`, the way a container page does, so the
  // route trail here would only repeat it.
  if (pathname === "/") return [];
  if (pathname.startsWith("/items/")) return [{ label: "Library", href: "/library" }];
  if (pathname.startsWith("/people/")) return [{ label: "People", href: "/people" }];
  return [{ label: "Home" }];
}
