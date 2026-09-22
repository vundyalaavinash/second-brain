export interface Crumb { label: string; href?: string }

const TOP: Record<string, string> = { "/today": "Today", "/inbox": "Inbox", "/projects": "Projects", "/areas": "Areas", "/resources": "Resources", "/people": "People", "/activity": "Activity", "/library": "Library", "/archive": "Archive", "/search": "Search", "/capture": "Capture" };

/**
 * The route's own trail. A crumb with an `href` is a parent the bar links to; one without
 * is the page's own label. A nested route contributes only its parent, because the page
 * supplies the title (and its separator) through `<Crumb>`.
 */
export function crumbsFor(pathname: string): Crumb[] {
  if (TOP[pathname]) return [{ label: TOP[pathname] }];
  if (pathname.startsWith("/c/")) return [{ label: "Projects, areas, resources", href: "/projects" }];
  if (pathname.startsWith("/items/")) return [{ label: "Library", href: "/library" }];
  if (pathname.startsWith("/people/")) return [{ label: "People", href: "/people" }];
  return [{ label: "Home" }];
}
