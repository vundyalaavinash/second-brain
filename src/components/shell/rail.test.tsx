// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Rail, RailSection } from "./rail";

afterEach(cleanup);

describe("Rail", () => {
  it("portals its sections into #rail-slot", () => {
    const slot = document.createElement("div");
    slot.id = "rail-slot";
    document.body.appendChild(slot);
    render(<Rail><RailSection label="Outline" count={2}>hello</RailSection></Rail>);
    expect(slot.querySelector("aside[aria-label='Context']")).not.toBeNull();
    expect(screen.getByText("Outline")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    slot.remove();
  });
});
