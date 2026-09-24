// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SpentLine } from "./spent-line";

/** Records every request the line makes and answers a PATCH as a success. */
function stubFetch(ok = true) {
  const calls: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return ok ? Response.json({}) : Response.json({ error: "nope" }, { status: 500 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SpentLine", () => {
  it("renders nothing when no run has landed against the task", () => {
    const { container } = render(<SpentLine taskId={1} estimateMinutes={45} spentMinutes={0} />);
    expect(container.textContent).toBe("");
  });

  it("reads the estimate against the actual, and offers to correct it when they disagree", () => {
    stubFetch();
    render(<SpentLine taskId={1} estimateMinutes={45} spentMinutes={80} />);
    expect(screen.getByText("Estimated 45m, spent 1h 20m")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use 1h 20m as the estimate" })).toBeTruthy();
  });

  it("reads just what was spent when there was no estimate, and still offers to set one", () => {
    stubFetch();
    render(<SpentLine taskId={1} estimateMinutes={null} spentMinutes={80} />);
    expect(screen.getByText("Spent 1h 20m")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use 1h 20m as the estimate" })).toBeTruthy();
  });

  it("says nothing about correcting the estimate once it already agrees with the actual", () => {
    stubFetch();
    render(<SpentLine taskId={1} estimateMinutes={45} spentMinutes={47} />);
    expect(screen.getByText("Estimated 45m, spent 47m")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("PATCHes the task with the real figure and tells the app the task changed", async () => {
    const calls = stubFetch();
    render(<SpentLine taskId={9} estimateMinutes={45} spentMinutes={80} />);
    const listen = vi.fn();
    window.addEventListener("sb:tasks-changed", listen);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Use 1h 20m as the estimate" }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({ url: "/api/tasks/9", method: "PATCH", body: { estimateMinutes: 80 } });
      await waitFor(() => expect(listen).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener("sb:tasks-changed", listen);
    }
  });

  it("shows an error and leaves the button usable again when the write fails", async () => {
    stubFetch(false);
    render(<SpentLine taskId={9} estimateMinutes={45} spentMinutes={80} />);
    fireEvent.click(screen.getByRole("button", { name: "Use 1h 20m as the estimate" }));
    expect(await screen.findByText("Could not update the estimate")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use 1h 20m as the estimate" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
