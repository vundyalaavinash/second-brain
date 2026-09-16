import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { activityCategories, activityRules, activityExclusions } from "./schema";

describe("activity schema seeds", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("seeds categories, rules, and exclusions", () => {
    const cats = t.db.select().from(activityCategories).all();
    expect(cats.map((c) => c.name)).toEqual(["Coding", "Meetings", "Communication", "Browsing", "Writing", "Leisure", "Other"]);
    const rules = t.db.select().from(activityRules).all();
    expect(rules.length).toBeGreaterThanOrEqual(20);
    expect(rules[0]).toMatchObject({ matchKind: "app", pattern: "com.microsoft.VSCode", sortOrder: 0 });
    const ex = t.db.select().from(activityExclusions).all();
    expect(ex.some((e) => e.kind === "app" && e.pattern === "com.1password.1password")).toBe(true);
    expect(ex.some((e) => e.kind === "domain" && e.pattern === "*.bank")).toBe(true);
  });
});
