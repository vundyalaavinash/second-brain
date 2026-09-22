import { describe, it, expect } from "vitest";
import { crumbsFor } from "./breadcrumb";

describe("crumbsFor", () => {
  it("maps top-level routes", () => {
    expect(crumbsFor("/inbox")).toEqual([{ label: "Inbox" }]);
    expect(crumbsFor("/today")).toEqual([{ label: "Today" }]);
    expect(crumbsFor("/search")).toEqual([{ label: "Search" }]);
  });
  it("nests containers, items, and people under their list", () => {
    expect(crumbsFor("/c/launch-newsletter")).toEqual([{ label: "Projects, areas, resources", href: "/projects" }, { label: "" }]);
    expect(crumbsFor("/items/13")).toEqual([{ label: "Library", href: "/library" }, { label: "" }]);
    expect(crumbsFor("/people/ada")).toEqual([{ label: "People", href: "/people" }, { label: "" }]);
  });
  it("falls back to Home", () => {
    expect(crumbsFor("/")).toEqual([{ label: "Home" }]);
  });
});
