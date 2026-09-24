// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { crumbsFor } from "@/lib/breadcrumb";
import Home from "./page";

vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/home", () => ({ homePayload: () => ({}) }));
// The page itself is the frame around Home, not Home: what it hands down is tested next door.
vi.mock("@/components/home/home-page", () => ({ HomePage: () => <div data-testid="home-page" /> }));

afterEach(() => {
  cleanup();
  document.getElementById("crumb-slot")?.remove();
});

/** The top bar's portal target, which the shell owns in the running app. */
function crumbSlot(): HTMLElement {
  const slot = document.createElement("div");
  slot.id = "crumb-slot";
  document.body.appendChild(slot);
  return slot;
}

describe("the Home route", () => {
  it("supplies the breadcrumb tail the route trail leaves empty", () => {
    // Spec §4 wants the bar to read "Home"; `crumbsFor("/")` is empty by design, so the only
    // thing that can put the word there is the page's own <Crumb>.
    expect(crumbsFor("/")).toEqual([]);
    const slot = crumbSlot();
    render(<Home />);
    expect(slot.textContent).toContain("Home");
    expect(screen.getByTestId("home-page")).toBeTruthy();
  });
});
