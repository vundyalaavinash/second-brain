// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Tray, Plus } from "@phosphor-icons/react";
import { DockItem } from "./dock-item";

vi.mock("next/navigation", () => ({ usePathname: () => "/inbox", useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

describe("DockItem", () => {
  it("folds the count and the helper state into the label", () => {
    render(<DockItem href="/inbox" label="Inbox" shortcut="g i" icon={Tray} badge={3} dot />);
    expect(screen.getByRole("link", { name: "Inbox, 3 waiting, not recording" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("caps the count pip", () => {
    render(<DockItem href="/inbox" label="Inbox" icon={Tray} badge={128} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("captions the active item and leaves its tooltip off", () => {
    render(<DockItem href="/inbox" label="Inbox" shortcut="g i" icon={Tray} active />);
    const link = screen.getByRole("link", { name: "Inbox" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Inbox")).toBeTruthy();
    fireEvent.pointerEnter(link);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a tooltip with the shortcut on hover", () => {
    render(<DockItem href="/inbox" label="Inbox" shortcut="g i" icon={Tray} />);
    const link = screen.getByRole("link", { name: "Inbox" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(link);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Inbox");
    expect(tip.textContent).toContain("g i");
    fireEvent.pointerLeave(link);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders a button that reports its expanded state when it has no href", () => {
    const onClick = vi.fn();
    render(<DockItem label="Capture" icon={Plus} expanded={false} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Capture" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});
