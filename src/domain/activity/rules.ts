import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  activityCategories,
  activityExclusions,
  activityRules,
  type ActivityCategory,
  type ActivityExclusion,
  type ActivityRule,
} from "@/db/schema";

export class ActivityError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ActivityError";
  }
}

export interface Sample {
  appId: string | null;
  appName: string | null;
  title: string | null;
  url: string | null;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const bare = host.startsWith("www.") ? host.slice(4) : host;
    return bare || null;
  } catch {
    return null;
  }
}

/** `github.com` matches `github.com` and `gist.github.com`; `*.bank` matches any host ending in `.bank`. */
function domainMatches(pattern: string, host: string | null): boolean {
  if (!host) return false;
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return host.endsWith(p.slice(1));
  return host === p || host.endsWith("." + p);
}

export function evaluateRules(rules: ActivityRule[], sample: Sample): number | null {
  const host = domainOf(sample.url);
  const title = (sample.title ?? "").toLowerCase();
  for (const r of rules) {
    if (r.matchKind === "app" && sample.appId === r.pattern) return r.categoryId;
    if (r.matchKind === "domain" && domainMatches(r.pattern, host)) return r.categoryId;
    if (r.matchKind === "title_contains" && title.includes(r.pattern.toLowerCase())) return r.categoryId;
  }
  return null;
}

export function isExcluded(exclusions: ActivityExclusion[], sample: Sample): boolean {
  const host = domainOf(sample.url);
  return exclusions.some((e) => (e.kind === "app" ? sample.appId === e.pattern : domainMatches(e.pattern, host)));
}

export function listRules(db: DB): ActivityRule[] {
  return db.select().from(activityRules).orderBy(asc(activityRules.sortOrder), asc(activityRules.id)).all();
}

function nextSortOrder(db: DB): number {
  const rows = listRules(db);
  return rows.length ? rows[rows.length - 1].sortOrder + 1 : 0;
}

export function createRule(db: DB, input: { matchKind: ActivityRule["matchKind"]; pattern: string; categoryId: number }): ActivityRule {
  const pattern = input.pattern.trim();
  if (!pattern) throw new ActivityError("Pattern is required");
  if (!db.select().from(activityCategories).where(eq(activityCategories.id, input.categoryId)).get()) throw new ActivityError("Unknown category", 404);
  const row = db
    .insert(activityRules)
    .values({ matchKind: input.matchKind, pattern, categoryId: input.categoryId, sortOrder: nextSortOrder(db) })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function updateRule(db: DB, id: number, patch: { matchKind?: ActivityRule["matchKind"]; pattern?: string; categoryId?: number }): ActivityRule {
  const set: Partial<typeof activityRules.$inferInsert> = {};
  if (patch.matchKind) set.matchKind = patch.matchKind;
  if (patch.pattern !== undefined) {
    const p = patch.pattern.trim();
    if (!p) throw new ActivityError("Pattern is required");
    set.pattern = p;
  }
  if (patch.categoryId !== undefined) {
    if (!db.select().from(activityCategories).where(eq(activityCategories.id, patch.categoryId)).get()) throw new ActivityError("Unknown category", 404);
    set.categoryId = patch.categoryId;
  }
  const row = db.update(activityRules).set(set).where(eq(activityRules.id, id)).returning().get();
  if (!row) throw new ActivityError("Rule not found", 404);
  return row;
}

export function deleteRule(db: DB, id: number): void {
  const res = db.delete(activityRules).where(eq(activityRules.id, id)).run();
  if (res.changes === 0) throw new ActivityError("Rule not found", 404);
}

/** Assigns sort_order by position; ids not listed keep their relative order after the listed ones. */
export function reorderRules(db: DB, ids: number[]): ActivityRule[] {
  const existing = listRules(db);
  const listed = new Set(ids);
  const ordered = [
    ...ids.map((id) => existing.find((r) => r.id === id)).filter((r): r is ActivityRule => !!r),
    ...existing.filter((r) => !listed.has(r.id)),
  ];
  db.transaction((tx) => {
    ordered.forEach((r, i) => tx.update(activityRules).set({ sortOrder: i }).where(eq(activityRules.id, r.id)).run());
  });
  return listRules(db);
}

export function listExclusions(db: DB): ActivityExclusion[] {
  return db.select().from(activityExclusions).orderBy(asc(activityExclusions.kind), asc(activityExclusions.pattern)).all();
}

export function addExclusion(db: DB, input: { kind: ActivityExclusion["kind"]; pattern: string }): ActivityExclusion {
  const trimmed = input.pattern.trim();
  const pattern = input.kind === "domain" ? trimmed.toLowerCase() : trimmed;
  if (!pattern) throw new ActivityError("Pattern is required");
  const dup = db
    .select()
    .from(activityExclusions)
    .where(and(eq(activityExclusions.kind, input.kind), eq(activityExclusions.pattern, pattern)))
    .get();
  if (dup) throw new ActivityError("That exclusion already exists", 409);
  const row = db.insert(activityExclusions).values({ kind: input.kind, pattern }).returning().get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function removeExclusion(db: DB, id: number): void {
  const res = db.delete(activityExclusions).where(eq(activityExclusions.id, id)).run();
  if (res.changes === 0) throw new ActivityError("Exclusion not found", 404);
}

export function listCategories(db: DB): ActivityCategory[] {
  return db.select().from(activityCategories).orderBy(asc(activityCategories.sortOrder)).all();
}

export function updateCategory(db: DB, id: number, patch: { name?: string; color?: string }): ActivityCategory {
  const set: Partial<typeof activityCategories.$inferInsert> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new ActivityError("Name is required");
    set.name = n;
  }
  if (patch.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(patch.color)) throw new ActivityError("Colour must be a hex value like #4cc9ff");
    set.color = patch.color.toLowerCase();
  }
  const row = db.update(activityCategories).set(set).where(eq(activityCategories.id, id)).returning().get();
  if (!row) throw new ActivityError("Category not found", 404);
  return row;
}
