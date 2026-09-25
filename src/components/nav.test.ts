import { describe, it, expect } from "vitest";
import { CAPTURE_ITEM, NAV_ITEMS, SEARCH_ITEM, isNavActive } from "./nav";

describe("NAV_ITEMS", () => {
  it("leads with Home on `g h`", () => {
    expect(NAV_ITEMS[0]).toEqual({ href: "/", label: "Home", shortcut: "g h", icon: "home", section: "brain" });
  });

  it("gives every view its own `g` letter", () => {
    const all = [...NAV_ITEMS, SEARCH_ITEM, CAPTURE_ITEM];
    const letters = all.map((n) => n.shortcut.split(" ")[1]);
    expect(all.every((n) => n.shortcut.startsWith("g "))).toBe(true);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it("sits Goals directly after Planner, above Projects", () => {
    const hrefs = NAV_ITEMS.map((n) => n.href);
    expect(hrefs.indexOf("/goals")).toBe(hrefs.indexOf("/planner") + 1);
    expect(NAV_ITEMS.find((n) => n.href === "/goals")).toEqual({ href: "/goals", label: "Goals", shortcut: "g g", icon: "goal", section: "brain" });
  });

  it("sits Review directly after Goals, on its own free shortcut", () => {
    const hrefs = NAV_ITEMS.map((n) => n.href);
    expect(hrefs.indexOf("/review")).toBe(hrefs.indexOf("/goals") + 1);
    expect(NAV_ITEMS.find((n) => n.href === "/review")).toEqual({ href: "/review", label: "Review", shortcut: "g w", icon: "review", section: "brain" });
  });
});

describe("isNavActive", () => {
  it("gives a view the routes nested under it", () => {
    expect(isNavActive("/planner", "/planner")).toBe(true);
    expect(isNavActive("/planner/week", "/planner")).toBe(true);
    expect(isNavActive("/plannerish", "/planner")).toBe(false);
  });

  it("keeps Home to itself, though its href prefixes every other", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/inbox", "/")).toBe(false);
  });
});
