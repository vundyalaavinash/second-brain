import { describe, it, expect } from "vitest";
import { crumbsFor } from "./breadcrumb";

describe("crumbsFor", () => {
  it("maps top-level routes", () => {
    expect(crumbsFor("/inbox")).toEqual([{ label: "Inbox" }]);
    expect(crumbsFor("/today")).toEqual([{ label: "Today" }]);
    expect(crumbsFor("/search")).toEqual([{ label: "Search" }]);
  });
  // Only the parent: the page supplies its own title through `<Crumb>`, so a route that
  // contributed an empty tail would leave the bar showing a trailing slash and nothing after it.
  it("nests items and people under their list", () => {
    expect(crumbsFor("/items/13")).toEqual([{ label: "Library", href: "/library" }]);
    expect(crumbsFor("/people/ada")).toEqual([{ label: "People", href: "/people" }]);
  });
  // A container page names its own kind through `<Crumb parent>`, so a route trail here
  // would show the parent twice.
  it("leaves the whole trail to the container page", () => {
    expect(crumbsFor("/c/launch-newsletter")).toEqual([]);
  });
  it("falls back to Home", () => {
    expect(crumbsFor("/")).toEqual([{ label: "Home" }]);
  });
});
