// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { SafetyStatusDTO } from "@/lib/dto";
import { describeSafety, SafetyLine } from "./safety-line";

const NOW = new Date("2026-09-25T15:00:00.000Z");

function status(over: Partial<SafetyStatusDTO> = {}): SafetyStatusDTO {
  return {
    lastBackupAt: "2026-09-25T12:00:00.000Z", // 3 hours before NOW
    verified: true,
    recoveryPoints: 17,
    oldest: "2026-04-12",
    integrity: { ok: true, problems: [] },
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("describeSafety", () => {
  it("says nothing is wrong in one line when nothing is wrong", () => {
    const { ok, text } = describeSafety(status(), NOW);
    expect(ok).toBe(true);
    expect(text).toBe("Backed up 3 hours ago, verified. 17 recovery points, back to 12 April.");
  });

  it("says so when the newest backup is older than two days", () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { ok, text } = describeSafety(status({ lastBackupAt: threeDaysAgo }), NOW);
    expect(ok).toBe(false);
    expect(text).toContain("3 days ago");
    expect(text).toContain("npm run backup");
  });

  it("says so when no backup has ever run", () => {
    const { ok, text } = describeSafety(status({ lastBackupAt: null }), NOW);
    expect(ok).toBe(false);
    expect(text).toContain("No backup has ever run");
    expect(text).toContain("npm run backup");
  });

  it("says so when the last backup failed to verify", () => {
    const { ok, text } = describeSafety(status({ verified: false, integrity: { ok: false, problems: ["not a database"] } }), NOW);
    expect(ok).toBe(false);
    expect(text).toContain("failed to verify");
    expect(text).toContain("npm run verify");
  });

  it("says so when the boot check found a problem, and names it", () => {
    const { ok, text } = describeSafety(status({ integrity: { ok: false, problems: ["1 foreign key violation(s)"] } }), NOW);
    expect(ok).toBe(false);
    expect(text).toContain("1 foreign key violation(s)");
    expect(text).toContain("npm run logs");
  });

  it("counts how far back the recovery points reach, singular when there is only one", () => {
    const { text } = describeSafety(status({ recoveryPoints: 1, oldest: "2026-01-05" }), NOW);
    expect(text).toContain("1 recovery point,");
    expect(text).not.toContain("1 recovery points");
    expect(text).toContain("5 January");
  });

  it("does not claim a backup failed to verify merely because a boot check failed", () => {
    // The single shared slot (db/safety.ts) can only be "backup" or "boot" at once -- a boot
    // failure must not also read as "the backup failed to verify".
    const { text } = describeSafety(status({ verified: true, integrity: { ok: false, problems: ["disk io error"] } }), NOW);
    expect(text).not.toContain("failed to verify");
    expect(text).toContain("disk io error");
  });
});

describe("SafetyLine", () => {
  it("renders the line once the status fetch resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(status())),
    );
    // A fixed `now` prop, not the real clock: the component defaults to `new Date()` in
    // production, but a test asserting the exact sentence needs a moment that never moves.
    render(<SafetyLine now={NOW} />);
    await waitFor(() => expect(screen.getByText("Backed up 3 hours ago, verified. 17 recovery points, back to 12 April.")).toBeTruthy());
  });

  it("renders nothing before the fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves within this test
    );
    const { container } = render(<SafetyLine now={NOW} />);
    expect(container.textContent).toBe("");
  });
});
