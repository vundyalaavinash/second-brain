// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MeetingTimePane } from "./meeting-time-pane";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/planner/meetings" }));

const TODAY = "2026-10-13";

function stub(payload: unknown) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json(payload);
    }),
  );
  return urls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAYMENTS = { containerId: 8, name: "Payments", kind: "project", slug: "payments", meetings: 6, minutes: 390 };
const ADMIN = { containerId: 9, name: "Admin", kind: "area", slug: "admin", meetings: 2, minutes: 45 };

describe("MeetingTimePane", () => {
  it("asks only about time already spent, not the list's future window", async () => {
    const urls = stub({ byContainer: [], unattributed: { meetings: 0, minutes: 0 } });
    render(<MeetingTimePane today={TODAY} />);
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    // 30 days back, and `to` exclusive of tomorrow so today is included and nothing later is.
    expect(urls[0]).toBe("/api/meetings/attribution?from=2026-09-13&to=2026-10-14");
  });

  it("ranks projects by the time they cost, in hours", async () => {
    stub({ byContainer: [PAYMENTS, ADMIN], unattributed: { meetings: 0, minutes: 0 } });
    render(<MeetingTimePane today={TODAY} />);
    expect(await screen.findByText("Payments")).toBeTruthy();
    expect(screen.getByText("6.5h")).toBeTruthy();
    expect(screen.getByText("45m")).toBeTruthy();
    expect(screen.getByText("6 mtgs")).toBeTruthy();
  });

  it("links each row to the project it is about", async () => {
    stub({ byContainer: [PAYMENTS], unattributed: { meetings: 0, minutes: 0 } });
    render(<MeetingTimePane today={TODAY} />);
    const link = await screen.findByRole("link", { name: /Payments/ });
    expect(link.getAttribute("href")).toBe("/c/payments");
  });

  /** The unaccounted total is the measure of how far the rest can be trusted, so it is never
   *  folded into a bucket or quietly dropped. */
  it("says how much time nothing claims", async () => {
    stub({ byContainer: [PAYMENTS], unattributed: { meetings: 4, minutes: 180 } });
    render(<MeetingTimePane today={TODAY} />);
    expect(await screen.findByText("3.0h unaccounted")).toBeTruthy();
    expect(screen.getByText(/4 meetings count against nothing yet/)).toBeTruthy();
  });

  it("says what to do when nothing is attributed but meetings exist", async () => {
    stub({ byContainer: [], unattributed: { meetings: 3, minutes: 90 } });
    render(<MeetingTimePane today={TODAY} />);
    expect(await screen.findByText(/Nothing is attributed yet/)).toBeTruthy();
  });

  /** A planner with no meetings at all should not carry an empty chart telling them so. */
  it("renders nothing when there is no meeting time either way", async () => {
    stub({ byContainer: [], unattributed: { meetings: 0, minutes: 0 } });
    const { container } = render(<MeetingTimePane today={TODAY} />);
    await waitFor(() => expect(screen.queryByLabelText("Where meeting time goes")).toBeNull());
    expect(container.querySelector("section")).toBeNull();
  });
});
