// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ActivityLine } from "./activity-line";

afterEach(cleanup);

describe("ActivityLine", () => {
  it("says how long the day has been active and what took the time", () => {
    render(
      <ActivityLine
        activity={{
          activeMs: 3 * 3_600_000 + 25 * 60_000,
          top: [
            { label: "Code", ms: 90 * 60_000 },
            { label: "github.com", ms: 40 * 60_000 },
            { label: "Slack", ms: 15 * 60_000 },
          ],
        }}
      />,
    );
    expect(screen.getByText("3h 25m")).toBeTruthy();
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual(["Code1h 30m", "github.com40m", "Slack15m"]);
    expect(screen.getByRole("link", { name: "Activity" }).getAttribute("href")).toBe("/activity");
  });

  it("says the day has nothing on it yet rather than three empty lines", () => {
    render(<ActivityLine activity={{ activeMs: 0, top: [] }} />);
    expect(screen.getByText("Nothing tracked yet today")).toBeTruthy();
  });

  it("is not there at all without a helper", () => {
    const { container } = render(<ActivityLine activity={null} />);
    expect(container.innerHTML).toBe("");
  });
});
