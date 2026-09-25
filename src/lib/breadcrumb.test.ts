import { describe, it, expect } from "vitest";
import { crumbsFor } from "./breadcrumb";

describe("crumbsFor", () => {
  it("maps top-level routes", () => {
    expect(crumbsFor("/inbox")).toEqual([{ label: "Inbox" }]);
    expect(crumbsFor("/planner")).toEqual([{ label: "Planner" }]);
    expect(crumbsFor("/search")).toEqual([{ label: "Search" }]);
  });
  // The Planner's own views are routes of their own, so the bar links back to the day.
  it("nests the Planner views under the Planner", () => {
    expect(crumbsFor("/planner/week")).toEqual([{ label: "Planner", href: "/planner" }, { label: "Week" }]);
    expect(crumbsFor("/planner/meetings")).toEqual([{ label: "Planner", href: "/planner" }, { label: "Meetings" }]);
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
  // Home supplies its own tail, so the route trail is empty there too.
  it("leaves the whole trail to Home", () => {
    expect(crumbsFor("/")).toEqual([]);
  });
  it("falls back to Home", () => {
    expect(crumbsFor("/nowhere")).toEqual([{ label: "Home" }]);
  });
});

describe("the routes the closing-the-loop slices added", () => {
  it("names Goals rather than falling through to Home", () => {
    // `/goals` renders no `<Crumb>` of its own, so the trail is the only thing that can name it;
    // without an entry here the fallback labelled the page "Home".
    expect(crumbsFor("/goals")).toEqual([{ label: "Goals" }]);
  });

  it("leaves a goal's own page to supply both halves", () => {
    // `GoalPage` renders `<Crumb title={goal.title} parent={{ label: "Goals" }} />`, so a trail
    // here would repeat the parent — the same rule container pages follow.
    expect(crumbsFor("/goals/7")).toEqual([{ label: "Home" }]);
  });

  it("leaves /review to its own Crumb", () => {
    expect(crumbsFor("/review")).toEqual([{ label: "Home" }]);
  });
});
