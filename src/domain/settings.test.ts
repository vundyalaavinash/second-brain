import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { getSetting, setSetting } from "./settings";

describe("settings", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("returns the fallback, then the stored value, and overwrites", () => {
    expect(getSetting(t.db, "activity_paused", "0")).toBe("0");
    setSetting(t.db, "activity_paused", "1");
    expect(getSetting(t.db, "activity_paused", "0")).toBe("1");
    setSetting(t.db, "activity_paused", "0");
    expect(getSetting(t.db, "activity_paused", "9")).toBe("0");
  });
});
