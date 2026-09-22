export interface Crumb { label: string; href?: string }

const TOP: Record<string, string> = { "/today": "Today", "/inbox": "Inbox", "/projects": "Projects", "/areas": "Areas", "/resources": "Resources", "/people": "People", "/activity": "Activity", "/library": "Library", "/archive": "Archive", "/search": "Search", "/capture": "Capture" };

/** The route's own trail. An empty last label means the page fills it through `<Crumb>`. */
export function crumbsFor(pathname: string): Crumb[] {
  if (TOP[pathname]) return [{ label: TOP[pathname] }];
  if (pathname.startsWith("/c/")) return [{ label: "Projects, areas, resources", href: "/projects" }, { label: "" }];
  if (pathname.startsWith("/items/")) return [{ label: "Library", href: "/library" }, { label: "" }];
  if (pathname.startsWith("/people/")) return [{ label: "People", href: "/people" }, { label: "" }];
  return [{ label: "Home" }];
}
