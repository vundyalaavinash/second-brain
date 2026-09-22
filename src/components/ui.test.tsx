// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button, List, Row } from "./ui";

// This vitest config has no global `afterEach`, so @testing-library/react's own auto-cleanup
// never registers and DOM from one `it` would otherwise still be attached in the next.
afterEach(cleanup);

describe("List and Row", () => {
  it("List renders a <ul> so Row's <li> children are valid list items, not orphans", () => {
    render(
      <List>
        <Row>Alpha</Row>
        <Row>Bravo</Row>
      </List>,
    );
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.tagName).toBe("LI");
    expect(list.className).toContain("list-none");
  });

  it("passes a caller className through alongside the base reset classes", () => {
    render(
      <List className="gap-2 opacity-90">
        <Row>Alpha</Row>
      </List>,
    );
    const list = screen.getByRole("list");
    expect(list.className).toContain("list-none");
    expect(list.className).toContain("gap-2 opacity-90");
  });
});

describe("Button", () => {
  it("paints the primary variant with the violet accent and its on-violet foreground", () => {
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("bg-violet");
    expect(button.className).toContain("text-on-violet");
  });
});
