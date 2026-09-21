// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DockMore } from "./dock-more";
import type { NavItem } from "../nav";

// This vitest config has no global `afterEach`, so @testing-library/react's own auto-cleanup
// never registers and window listeners from one `it` would otherwise leak into the next.
afterEach(cleanup);

const items: NavItem[] = [
  { href: "/areas", label: "Areas", shortcut: "g a", icon: "area", group: "para" },
  { href: "/resources", label: "Resources", shortcut: "g r", icon: "resource", group: "para" },
];

function open() {
  render(<DockMore items={items} pathname="/areas" />);
  fireEvent.click(screen.getByRole("button", { name: "More destinations" }));
}

describe("DockMore", () => {
  it("toggles aria-expanded and the sheet's contents", () => {
    render(<DockMore items={items} pathname="/areas" />);
    const trigger = screen.getByRole("button", { name: "More destinations" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /^Areas/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Resources/ })).toBeTruthy();
  });

  it("closes on Escape", () => {
    open();
    expect(screen.getByRole("button", { name: "More destinations" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "More destinations" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("the trailing Commands row dispatches sb:palette and closes the sheet, replacing the missing narrow-dock palette trigger", () => {
    open();
    const onPalette = vi.fn();
    window.addEventListener("sb:palette", onPalette);
    const commands = screen.getByRole("button", { name: /^Commands/ });
    expect(commands.textContent).toContain("⌘K");
    fireEvent.click(commands);
    expect(onPalette).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "More destinations" }).getAttribute("aria-expanded")).toBe("false");
    window.removeEventListener("sb:palette", onPalette);
  });
});
