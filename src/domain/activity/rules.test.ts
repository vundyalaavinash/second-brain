import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { domainOf, evaluateRules, isExcluded, listRules, listCategories, createRule, reorderRules, listExclusions, addExclusion, deleteRule } from "./rules";

describe("activity rules", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("extracts domains", () => {
    expect(domainOf("https://www.github.com/x/y?z=1")).toBe("github.com");
    expect(domainOf("http://meet.google.com/abc")).toBe("meet.google.com");
    expect(domainOf("not a url")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it("first matching rule wins, in sort order", () => {
    const rules = listRules(t.db);
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(evaluateRules(rules, { appId: "com.google.Chrome", appName: "Chrome", title: "x", url: "https://github.com/a" })).toBe(cats.Coding);
    expect(evaluateRules(rules, { appId: "com.google.Chrome", appName: "Chrome", title: "x", url: "https://example.org" })).toBe(cats.Browsing);
    expect(evaluateRules(rules, { appId: "com.unknown.app", appName: "?", title: "x", url: null })).toBeNull();
  });

  it("matches parent domains and title_contains case-insensitively", () => {
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    const r = createRule(t.db, { matchKind: "title_contains", pattern: "interview", categoryId: cats.Meetings });
    reorderRules(t.db, [r.id, ...listRules(t.db).filter((x) => x.id !== r.id).map((x) => x.id)]);
    const rules = listRules(t.db);
    expect(rules[0].id).toBe(r.id);
    expect(evaluateRules(rules, { appId: "com.microsoft.VSCode", appName: "Code", title: "INTERVIEW notes", url: null })).toBe(cats.Meetings);
    expect(evaluateRules(rules, { appId: "com.google.Chrome", appName: "Chrome", title: "t", url: "https://gist.github.com/x" })).toBe(cats.Coding);
    deleteRule(t.db, r.id);
    expect(listRules(t.db).some((x) => x.id === r.id)).toBe(false);
  });

  it("applies exclusions with wildcards", () => {
    addExclusion(t.db, { kind: "domain", pattern: "*.internal.example" });
    const ex = listExclusions(t.db);
    expect(isExcluded(ex, { appId: "com.1password.1password", appName: "1Password", title: null, url: null })).toBe(true);
    expect(isExcluded(ex, { appId: "com.google.Chrome", appName: "Chrome", title: null, url: "https://foo.internal.example/x" })).toBe(true);
    expect(isExcluded(ex, { appId: "com.google.Chrome", appName: "Chrome", title: null, url: "https://chase.com/login" })).toBe(true);
    expect(isExcluded(ex, { appId: "com.google.Chrome", appName: "Chrome", title: null, url: "https://example.com" })).toBe(false);
    expect(() => addExclusion(t.db, { kind: "domain", pattern: "*.internal.example" })).toThrow(/already/);
  });
});
