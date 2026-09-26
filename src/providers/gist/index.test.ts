import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs");

describe("hasGistModel / getGistProvider", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("is off when the model file is absent, same as summarize_meeting with no key", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { hasGistModel, getGistProvider } = await import("./index");
    expect(hasGistModel()).toBe(false);
    expect(getGistProvider()).toBeNull();
  });

  it("is on when the model file is present", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const { hasGistModel, getGistProvider } = await import("./index");
    expect(hasGistModel()).toBe(true);
    expect(getGistProvider()).not.toBeNull();
  });
});
