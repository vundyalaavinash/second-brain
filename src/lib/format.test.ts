import { describe, it, expect } from "vitest";
import { relativeTime, formatDate } from "./format";

describe("format", () => {
  const now = new Date("2026-09-12T12:00:00Z").getTime();
  it("renders relative times in compact form", () => {
    expect(relativeTime("2026-09-12T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-09-12T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-09-12T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-10T12:00:00Z", now)).toBe("2d ago");
    expect(relativeTime("2026-01-05T12:00:00Z", now)).toBe(formatDate("2026-01-05T12:00:00Z"));
  });
  it("formats dates as dd Mon yyyy", () => {
    expect(formatDate("2026-01-05T12:00:00Z")).toMatch(/^0?5 Jan 2026$/);
  });
});
