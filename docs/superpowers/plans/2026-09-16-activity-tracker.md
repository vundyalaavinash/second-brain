# Activity Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record where time goes on the Mac (app, window, site, away time, calendar meeting) through a small Swift helper, and show a day timeline, totals, meetings, week view, and rules in the app.

**Architecture:** A Swift launchd agent samples the frontmost app every 5 s and posts heartbeats to the Next.js server with a bearer token; the server folds heartbeats into `activity_sessions`, categorises them with ordered rules, labels call sessions with overlapping calendar events, and prunes by retention. A client page at `/activity` renders the day and week from two read endpoints.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, better-sqlite3 + Drizzle (drizzle-kit migrations in `drizzle/`), zod 4, Vitest 5, lucide-react; Swift 5.9 package (macOS 13+) using AppKit, ApplicationServices (AX), EventKit, Foundation.

**Spec:** `docs/superpowers/specs/2026-09-16-activity-and-rich-notes-design.md` sections 2, 4, 5 (activity parts). The 2026-09-12 spec's architecture and copy rules bind.

## Global Constraints

- Timestamps are ISO-8601 UTC strings produced by `nowIso()` from `src/lib/time.ts`; `day` columns are local `YYYY-MM-DD`.
- Every table goes through `src/db/schema.ts` plus a drizzle-kit migration in `drizzle/`; run `npm run db:generate` then inspect the SQL; hand-patch `ON DELETE` clauses if drizzle-kit omits them (it did for containers).
- API routes follow `src/app/api/people/route.ts`: `export const dynamic = "force-dynamic"`, zod `safeParse` then 400, domain errors through `errorResponse` in `src/lib/api.ts`.
- Heartbeat and calendar routes require `Authorization: Bearer <token>` where the token is the trimmed content of `DATA_DIR/activity-token`; wrong or missing token gives 401 `{ error: "Unauthorized" }`.
- Copy rules: sentence case; no uppercase tracked labels; no middle-dot strings; buttons name the action; mono only for ids, counts, timestamps, slugs, shortcut keys.
- UI uses the primitives in `src/components/ui.tsx` (`PageHeader`, `SectionHeading`, `Button`, `IconButton`, `Chip`, `Input`, `Select`, `List`, `Row`, `EmptyState`, `Kbd`) and Lucide icons; frosted panels use `.frost`.
- The helper lives at `helper/activity/` (matches the gitignored `helper/recorder/.build/` convention); its build output `helper/activity/.build/` is gitignored.
- Nothing leaves the machine; the helper talks only to `127.0.0.1`.
- Every commit ends with the two trailer lines shown in each commit step.
- `npm test && npm run lint && npm run build` must be clean at the end of every task. Do not start a server on port 3141 during implementation (the launch agent or the controller owns it).

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` | five new tables and their types |
| `drizzle/0002_*.sql` | migration including seed inserts |
| `src/domain/settings.ts` | `getSetting` / `setSetting` over the existing `settings` table |
| `src/domain/activity/rules.ts` | `domainOf`, `evaluateRules`, `isExcluded`, rule/exclusion/category CRUD, `ActivityError` |
| `src/domain/activity/sessions.ts` | `ingestHeartbeat`, gap and debounce logic, `labelSession`, `recategorise`, `pruneActivity` |
| `src/domain/activity/calendar.ts` | `replaceCalendarEvents`, `findMeetingFor`, `labelMeetings`, `captureMeeting`, `localDay`, `dayBounds` |
| `src/domain/activity/report.ts` | `getDay`, `getWeek`, `addDays` |
| `src/domain/activity/helper-state.ts` | helper state, pause, retention settings |
| `src/domain/activity/index.ts` | re-exports |
| `src/app/api/activity/**` | routes |
| `src/lib/activity-auth.ts` | token file read and `requireHelperToken(req)` |
| `src/lib/dto.ts` | `ActivityDayDTO`, `ActivityWeekDTO`, `ActivityRuleDTO`, and friends |
| `helper/activity/Package.swift`, `Sources/sb-activity/*.swift` | the helper |
| `scripts/brain.sh` | second agent, token, helper build, status |
| `src/components/nav.ts`, `icons.tsx`, `dock.tsx` | Activity entry and helper-down dot |
| `src/app/activity/page.tsx`, `src/components/activity/*.tsx` | the page |

---

### Task 1: Schema, migration, seeds, settings helper

**Files:**
- Modify: `src/db/schema.ts` (append after `settings`)
- Create: `drizzle/0002_activity.sql` (generated then edited), `drizzle/meta/0002_snapshot.json` (generated)
- Create: `src/domain/settings.ts`, `src/domain/settings.test.ts`
- Test: `src/db/activity-schema.test.ts`

**Interfaces:**
- Produces: tables `activityCategories`, `activityRules`, `activityExclusions`, `activitySessions`, `calendarEvents` and types `ActivityCategory`, `ActivityRule`, `ActivityExclusion`, `ActivitySession`, `CalendarEvent`; `getSetting(db, key, fallback): string`, `setSetting(db, key, value): void`.

- [ ] **Step 1: Write the failing schema test**

```ts
// src/db/activity-schema.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/db/activity-schema.test.ts`
Expected: FAIL, `activityCategories` is not exported.

- [ ] **Step 3: Add the tables to the schema**

Append to `src/db/schema.ts` (add `uniqueIndex` to the existing drizzle import):

```ts
export const ACTIVITY_MATCH_KINDS = ["app", "domain", "title_contains"] as const;
export const ACTIVITY_EXCLUSION_KINDS = ["app", "domain"] as const;

export const activityCategories = sqliteTable("activity_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const activityRules = sqliteTable(
  "activity_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchKind: text("match_kind", { enum: ACTIVITY_MATCH_KINDS }).notNull(),
    pattern: text("pattern").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => activityCategories.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("activity_rules_order_idx").on(t.sortOrder)],
);

export const activityExclusions = sqliteTable(
  "activity_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ACTIVITY_EXCLUSION_KINDS }).notNull(),
    pattern: text("pattern").notNull(),
  },
  (t) => [uniqueIndex("activity_exclusions_kind_pattern_unique").on(t.kind, t.pattern)],
);

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull().unique(),
    title: text("title").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    attendees: integer("attendees").notNull().default(0),
    hasCallLink: integer("has_call_link").notNull().default(0),
    day: text("day").notNull(),
  },
  (t) => [index("calendar_events_day_idx").on(t.day)],
);

export const activitySessions = sqliteTable(
  "activity_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    closed: integer("closed").notNull().default(0),
    appId: text("app_id"),
    appName: text("app_name"),
    title: text("title"),
    url: text("url"),
    domain: text("domain"),
    categoryId: integer("category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    afk: integer("afk").notNull().default(0),
    meetingId: integer("meeting_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    heartbeats: integer("heartbeats").notNull().default(1),
    titleChangedAt: text("title_changed_at"),
  },
  (t) => [index("activity_sessions_started_idx").on(t.startedAt), index("activity_sessions_ended_idx").on(t.endedAt)],
);

export type ActivityCategory = typeof activityCategories.$inferSelect;
export type ActivityRule = typeof activityRules.$inferSelect;
export type ActivityExclusion = typeof activityExclusions.$inferSelect;
export type ActivitySession = typeof activitySessions.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
```

`endedAt` is always set (to the last heartbeat); `closed` says whether the session may still be extended.

- [ ] **Step 4: Generate the migration and add seeds**

Run: `npm run db:generate -- --name activity`
Expected: `drizzle/0002_activity.sql` created. Open it and verify the `ON DELETE` clauses (`cascade` on `activity_rules.category_id`, `set null` on `activity_sessions.category_id` and `meeting_id`); add them by hand if missing. Then append these seed statements to the end of the file, each separated by `--> statement-breakpoint`:

```sql
INSERT INTO `activity_categories` (`name`,`color`,`sort_order`) VALUES ('Coding','#4cc9ff',0),('Meetings','#f5c451',1),('Communication','#52d38a',2),('Browsing','#9b9ba4',3),('Writing','#c084fc',4),('Leisure','#ff5c6c',5),('Other','#62626b',6);--> statement-breakpoint
INSERT INTO `activity_rules` (`match_kind`,`pattern`,`category_id`,`sort_order`) VALUES
('app','com.microsoft.VSCode',1,0),('app','com.apple.Terminal',1,1),('app','com.googlecode.iterm2',1,2),('app','dev.warp.Warp-Stable',1,3),
('domain','github.com',1,4),('domain','gitlab.com',1,5),
('app','us.zoom.xos',2,6),('app','com.microsoft.teams2',2,7),('app','com.webex.meetingmanager',2,8),
('domain','meet.google.com',2,9),('domain','zoom.us',2,10),
('app','com.tinyspeck.slackmacgap',3,11),('app','com.apple.mail',3,12),('app','com.apple.MobileSMS',3,13),('app','com.hnc.Discord',3,14),
('domain','mail.google.com',3,15),('domain','slack.com',3,16),
('app','com.apple.Notes',5,17),('app','md.obsidian',5,18),('app','com.apple.iWork.Pages',5,19),
('domain','youtube.com',6,20),('domain','netflix.com',6,21),('domain','reddit.com',6,22),('domain','twitter.com',6,23),('domain','x.com',6,24),
('app','com.apple.Safari',4,25),('app','com.google.Chrome',4,26),('app','company.thebrowser.Browser',4,27),('app','com.brave.Browser',4,28),('app','com.microsoft.edgemac',4,29);--> statement-breakpoint
INSERT INTO `activity_exclusions` (`kind`,`pattern`) VALUES
('app','com.1password.1password'),('app','com.agilebits.onepassword7'),('app','com.bitwarden.desktop'),('app','com.apple.keychainaccess'),
('domain','*.bank'),('domain','chase.com'),('domain','bankofamerica.com'),('domain','wellsfargo.com'),('domain','paypal.com'),('domain','accounts.google.com'),('domain','login.microsoftonline.com');
```

Category ids in the rules rely on the insert order above (Coding=1 through Other=7) in a fresh table; the migration runs once on an empty table so this holds.

- [ ] **Step 5: Run the schema test**

Run: `npx vitest run src/db/activity-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing settings test**

```ts
// src/domain/settings.test.ts
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
```

- [ ] **Step 7: Implement settings**

```ts
// src/domain/settings.ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { settings } from "@/db/schema";

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? fallback;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
```

- [ ] **Step 8: Run all tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green (100 tests).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts drizzle src/domain/settings.ts src/domain/settings.test.ts src/db/activity-schema.test.ts
git commit -m "feat(activity): tables, seeds, and settings helper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 2: Rules, exclusions, and session folding

**Files:**
- Create: `src/domain/activity/rules.ts`, `src/domain/activity/sessions.ts`, `src/domain/activity/calendar.ts` (stub), `src/domain/activity/index.ts`
- Test: `src/domain/activity/rules.test.ts`, `src/domain/activity/sessions.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and types.
- Produces:
  - `class ActivityError extends Error { status: number }`
  - `domainOf(url: string | null | undefined): string | null`
  - `type Sample = { appId: string | null; appName: string | null; title: string | null; url: string | null }`
  - `evaluateRules(rules: ActivityRule[], sample: Sample): number | null` (category id)
  - `isExcluded(exclusions: ActivityExclusion[], sample: Sample): boolean`
  - `listRules(db)`, `createRule(db, { matchKind, pattern, categoryId })`, `updateRule(db, id, patch)`, `deleteRule(db, id)`, `reorderRules(db, ids: number[])`
  - `listExclusions(db)`, `addExclusion(db, { kind, pattern })`, `removeExclusion(db, id)`
  - `listCategories(db)`, `updateCategory(db, id, { name?, color? })`
  - `type Heartbeat = { at: string; afk?: boolean; appId?: string | null; appName?: string | null; title?: string | null; url?: string | null }`
  - `ingestHeartbeat(db, hb: Heartbeat): ActivitySession | null` (null when excluded or ignored)
  - `getOpenSession(db): ActivitySession | undefined`
  - `labelSession(db, id, patch: { categoryId?: number | null; meetingId?: number | null }): ActivitySession`
  - `recategorise(db, days: number, now?: Date): number`
  - `pruneActivity(db, retentionDays: number, now?: Date): { sessions: number; events: number }`
  - `AFK_SECONDS = 180`, `GAP_MS = 15 * 60_000`, `TITLE_DEBOUNCE_MS = 20_000`, `EXCLUDED_APP_ID = "excluded"` (the helper sends this app id in place of a locally dropped sample so the previous session still closes).
  - `findMeetingFor(db, at: string): CalendarEvent | undefined` (stub here, real in Task 3).

- [ ] **Step 1: Write the failing rules test**

```ts
// src/domain/activity/rules.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/activity/rules.test.ts`
Expected: FAIL, cannot find module `./rules`.

- [ ] **Step 3: Implement rules.ts**

```ts
// src/domain/activity/rules.ts
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
  const pattern = input.pattern.trim().toLowerCase();
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
```

- [ ] **Step 4: Run the rules test**

Run: `npx vitest run src/domain/activity/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing sessions test**

```ts
// src/domain/activity/sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { activitySessions } from "@/db/schema";
import { ingestHeartbeat, getOpenSession, recategorise, pruneActivity, labelSession, EXCLUDED_APP_ID } from "./sessions";
import { listCategories, createRule, reorderRules, listRules } from "./rules";

const T0 = Date.parse("2026-09-16T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const code = (s: number, title = "a.ts") => ({ at: at(s), appId: "com.microsoft.VSCode", appName: "Code", title, url: null });
const chrome = (s: number, url: string, title = "tab") => ({ at: at(s), appId: "com.google.Chrome", appName: "Chrome", title, url });

describe("session folding", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  const all = () => t.db.select().from(activitySessions).orderBy(activitySessions.id).all();

  it("extends on the same key and splits on change", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, code(5));
    ingestHeartbeat(t.db, code(10));
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ startedAt: at(0), endedAt: at(10), heartbeats: 3, closed: 0 });
    ingestHeartbeat(t.db, chrome(15, "https://github.com/x"));
    const s = all();
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ endedAt: at(15), closed: 1 });
    expect(s[1]).toMatchObject({ startedAt: at(15), domain: "github.com", endedAt: at(15) });
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(s[0].categoryId).toBe(cats.Coding);
    expect(s[1].categoryId).toBe(cats.Coding);
  });

  it("debounces title flicker within 20 seconds, splits after", () => {
    ingestHeartbeat(t.db, code(0, "one"));
    ingestHeartbeat(t.db, code(5, "two"));
    expect(all()).toHaveLength(1);
    expect(all()[0].title).toBe("two");
    ingestHeartbeat(t.db, code(10, "three"));
    expect(all()).toHaveLength(1);
    ingestHeartbeat(t.db, code(40, "four"));
    expect(all()).toHaveLength(2);
  });

  it("afk closes the open session and opens an afk session", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, { at: at(200), afk: true });
    ingestHeartbeat(t.db, { at: at(205), afk: true });
    let s = all();
    expect(s).toHaveLength(2);
    expect(s[0].endedAt).toBe(at(200));
    expect(s[1]).toMatchObject({ afk: 1, startedAt: at(200), endedAt: at(205) });
    ingestHeartbeat(t.db, code(210));
    s = all();
    expect(s).toHaveLength(3);
    expect(s[1].endedAt).toBe(at(210));
  });

  it("closes at the last heartbeat across a gap over 15 minutes", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, code(5));
    ingestHeartbeat(t.db, code(5 + 16 * 60));
    const s = all();
    expect(s).toHaveLength(2);
    expect(s[0].endedAt).toBe(at(5));
    expect(s[1].startedAt).toBe(at(5 + 16 * 60));
  });

  it("ignores out-of-order heartbeats and excluded samples", () => {
    ingestHeartbeat(t.db, code(10));
    expect(ingestHeartbeat(t.db, code(5))).toBeNull();
    expect(all()).toHaveLength(1);
    expect(ingestHeartbeat(t.db, chrome(20, "https://chase.com/x"))).toBeNull();
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ endedAt: at(20), closed: 1 });
    expect(getOpenSession(t.db)).toBeUndefined();
    ingestHeartbeat(t.db, code(25));
    expect(ingestHeartbeat(t.db, { at: at(30), appId: EXCLUDED_APP_ID, appName: "Excluded", title: null, url: null })).toBeNull();
    expect(all()).toHaveLength(2);
    expect(all()[1].closed).toBe(1);
  });

  it("recategorises after rules change and labels by hand", () => {
    ingestHeartbeat(t.db, chrome(0, "https://example.org"));
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(all()[0].categoryId).toBe(cats.Browsing);
    const r = createRule(t.db, { matchKind: "domain", pattern: "example.org", categoryId: cats.Writing });
    reorderRules(t.db, [r.id, ...listRules(t.db).filter((x) => x.id !== r.id).map((x) => x.id)]);
    expect(recategorise(t.db, 30, new Date(T0 + 60_000))).toBe(1);
    expect(all()[0].categoryId).toBe(cats.Writing);
    const labelled = labelSession(t.db, all()[0].id, { categoryId: cats.Leisure });
    expect(labelled.categoryId).toBe(cats.Leisure);
    expect(() => labelSession(t.db, 999, { categoryId: null })).toThrow(/not found/);
  });

  it("prunes by retention", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, { ...code(0), at: new Date(T0 + 100 * 86_400_000).toISOString() });
    expect(pruneActivity(t.db, 90, new Date(T0 + 100 * 86_400_000)).sessions).toBe(1);
    expect(all()).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/domain/activity/sessions.test.ts`
Expected: FAIL, cannot find module `./sessions`.

- [ ] **Step 7: Implement sessions.ts, the calendar stub, and index.ts**

```ts
// src/domain/activity/sessions.ts
import { desc, eq, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents, type ActivitySession } from "@/db/schema";
import { ActivityError, domainOf, evaluateRules, isExcluded, listCategories, listExclusions, listRules, type Sample } from "./rules";
import { findMeetingFor } from "./calendar";

export const AFK_SECONDS = 180;
export const GAP_MS = 15 * 60_000;
export const TITLE_DEBOUNCE_MS = 20_000;
/** The helper substitutes this app id for samples it dropped locally, so the previous session still closes. */
export const EXCLUDED_APP_ID = "excluded";

export interface Heartbeat {
  at: string;
  afk?: boolean;
  appId?: string | null;
  appName?: string | null;
  title?: string | null;
  url?: string | null;
}

function latestSession(db: DB): ActivitySession | undefined {
  return db.select().from(activitySessions).orderBy(desc(activitySessions.id)).get();
}

/** The latest session, if it can still be extended. */
export function getOpenSession(db: DB): ActivitySession | undefined {
  const latest = latestSession(db);
  return latest && !latest.closed ? latest : undefined;
}

function close(db: DB, s: ActivitySession, endedAt: string): void {
  db.update(activitySessions).set({ endedAt, closed: 1 }).where(eq(activitySessions.id, s.id)).run();
}

function extend(db: DB, s: ActivitySession, at: string): ActivitySession {
  const row = db
    .update(activitySessions)
    .set({ endedAt: at, heartbeats: s.heartbeats + 1 })
    .where(eq(activitySessions.id, s.id))
    .returning()
    .get();
  if (!row) throw new Error("Update returned no row");
  return row;
}

function keyOf(s: { appId: string | null; domain: string | null; title: string | null }): string {
  return JSON.stringify([s.appId, s.domain, s.title]);
}

function meetingsCategoryId(db: DB): number | null {
  return listCategories(db).find((c) => c.name === "Meetings")?.id ?? null;
}

function open(db: DB, at: string, sample: Sample | null): ActivitySession {
  const domain = sample ? domainOf(sample.url) : null;
  const categoryId = sample ? evaluateRules(listRules(db), sample) : null;
  const meeting = sample && categoryId !== null && categoryId === meetingsCategoryId(db) ? findMeetingFor(db, at) : undefined;
  const row = db
    .insert(activitySessions)
    .values({
      startedAt: at,
      endedAt: at,
      closed: 0,
      appId: sample?.appId ?? null,
      appName: sample?.appName ?? null,
      title: sample?.title ?? null,
      url: sample?.url ?? null,
      domain,
      categoryId,
      afk: sample ? 0 : 1,
      meetingId: meeting?.id ?? null,
      heartbeats: 1,
      titleChangedAt: null,
    })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

/**
 * Fold one heartbeat into sessions. Returns the session it landed in, or null when ignored (older than the
 * latest heartbeat) or excluded. An excluded sample still closes whatever was open.
 */
export function ingestHeartbeat(db: DB, hb: Heartbeat): ActivitySession | null {
  const t = Date.parse(hb.at);
  if (Number.isNaN(t)) throw new ActivityError("Invalid timestamp");
  const latest = latestSession(db);
  if (latest && t < Date.parse(latest.endedAt)) return null;

  const sample: Sample | null = hb.afk
    ? null
    : { appId: hb.appId ?? null, appName: hb.appName ?? null, title: hb.title ?? null, url: hb.url ?? null };

  if (sample && (sample.appId === EXCLUDED_APP_ID || isExcluded(listExclusions(db), sample))) {
    if (latest && !latest.closed) close(db, latest, hb.at);
    return null;
  }
  if (!latest || latest.closed) return open(db, hb.at, sample);

  if (t - Date.parse(latest.endedAt) > GAP_MS) {
    close(db, latest, latest.endedAt);
    return open(db, hb.at, sample);
  }
  if (!sample) {
    if (latest.afk) return extend(db, latest, hb.at);
    close(db, latest, hb.at);
    return open(db, hb.at, null);
  }
  if (latest.afk) {
    close(db, latest, hb.at);
    return open(db, hb.at, sample);
  }
  const domain = domainOf(sample.url);
  if (keyOf(latest) === keyOf({ appId: sample.appId, domain, title: sample.title })) return extend(db, latest, hb.at);

  const sameContext = latest.appId === sample.appId && (latest.domain ?? "") === (domain ?? "");
  const lastChange = Date.parse(latest.titleChangedAt ?? latest.startedAt);
  if (sameContext && t - lastChange <= TITLE_DEBOUNCE_MS) {
    const row = db
      .update(activitySessions)
      .set({ title: sample.title, url: sample.url, endedAt: hb.at, heartbeats: latest.heartbeats + 1, titleChangedAt: hb.at })
      .where(eq(activitySessions.id, latest.id))
      .returning()
      .get();
    return row ?? null;
  }
  close(db, latest, hb.at);
  return open(db, hb.at, sample);
}

export function labelSession(db: DB, id: number, patch: { categoryId?: number | null; meetingId?: number | null }): ActivitySession {
  const set: Partial<typeof activitySessions.$inferInsert> = {};
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
  if (patch.meetingId !== undefined) {
    if (patch.meetingId !== null && !db.select().from(calendarEvents).where(eq(calendarEvents.id, patch.meetingId)).get()) {
      throw new ActivityError("Meeting not found", 404);
    }
    set.meetingId = patch.meetingId;
  }
  if (Object.keys(set).length === 0) throw new ActivityError("Nothing to change");
  const row = db.update(activitySessions).set(set).where(eq(activitySessions.id, id)).returning().get();
  if (!row) throw new ActivityError("Session not found", 404);
  return row;
}

/** Re-evaluate rules for non-afk sessions started in the last `days` days. Returns the number of rows changed. */
export function recategorise(db: DB, days: number, now: Date = new Date()): number {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rules = listRules(db);
  const rows = db.select().from(activitySessions).where(eq(activitySessions.afk, 0)).all().filter((s) => s.startedAt >= since);
  let changed = 0;
  db.transaction((tx) => {
    for (const s of rows) {
      const categoryId = evaluateRules(rules, { appId: s.appId, appName: s.appName, title: s.title, url: s.url });
      if (categoryId !== s.categoryId) {
        tx.update(activitySessions).set({ categoryId }).where(eq(activitySessions.id, s.id)).run();
        changed++;
      }
    }
  });
  return changed;
}

export function pruneActivity(db: DB, retentionDays: number, now: Date = new Date()): { sessions: number; events: number } {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const sessions = db.delete(activitySessions).where(lt(activitySessions.startedAt, cutoff)).run().changes;
  const events = db.delete(calendarEvents).where(lt(calendarEvents.endsAt, cutoff)).run().changes;
  return { sessions, events };
}
```

```ts
// src/domain/activity/calendar.ts  (stub; Task 3 replaces this file)
import type { DB } from "@/db/client";
import type { CalendarEvent } from "@/db/schema";

export function findMeetingFor(_db: DB, _at: string): CalendarEvent | undefined {
  return undefined;
}
```

```ts
// src/domain/activity/index.ts
export * from "./rules";
export * from "./sessions";
export * from "./calendar";
```

- [ ] **Step 8: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/domain/activity
git commit -m "feat(activity): rules, exclusions, and session folding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 3: Calendar events, meeting labels, day and week reports, capture as meeting

**Files:**
- Modify: `src/domain/activity/calendar.ts` (replace the stub), `src/domain/activity/index.ts`
- Create: `src/domain/activity/report.ts`
- Test: `src/domain/activity/calendar.test.ts`, `src/domain/activity/report.test.ts`

**Interfaces:**
- Consumes: Task 2 functions; `createItem` and `parseMeta` from `src/domain/items`.
- Produces:
  - `type CalendarEventInput = { externalId: string; title: string; startsAt: string; endsAt: string; attendees: number; hasCallLink: boolean }`
  - `replaceCalendarEvents(db, events): { days: string[]; inserted: number }` (replaces every event whose local day is among the days present in the payload, then `labelMeetings(db, days)`)
  - `findMeetingFor(db, at): CalendarEvent | undefined` (overlapping event, call-link first, then earliest start)
  - `labelMeetings(db, days): number` (sets `meetingId` on Meetings-category sessions overlapping an event where `meetingId` is null)
  - `isInterview(title): boolean`
  - `findCapturedMeetingItem(db, eventId): Item | undefined`
  - `captureMeeting(db, eventId): Item` (idempotent through `items.meta.calendarEventId`)
  - `localDay(iso): string`, `dayBounds(day): { start: string; end: string }` (local midnight to next local midnight as UTC ISO; throws `ActivityError` on a malformed day)
  - `interface ActivityDay { day; activeMs; sessions: DaySession[]; byCategory; byApp; bySite; meetings }` as written in `report.ts` below
  - `getDay(db, day): ActivityDay`, `getWeek(db, start): { start; days: { day; activeMs; byCategory }[] }`, `addDays(day, n): string`.

- [ ] **Step 1: Write the failing calendar test**

```ts
// src/domain/activity/calendar.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { activitySessions, calendarEvents } from "@/db/schema";
import { replaceCalendarEvents, findMeetingFor, isInterview, captureMeeting, labelMeetings, localDay, dayBounds } from "./calendar";
import { ingestHeartbeat } from "./sessions";
import { parseMeta } from "@/domain/items";

const T0 = Date.parse("2026-09-16T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const zoom = (s: number) => ({ at: at(s), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });

describe("calendar", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("computes local days and bounds", () => {
    const day = localDay(at(0));
    const { start, end } = dayBounds(day);
    expect(Date.parse(end) - Date.parse(start)).toBe(86_400_000);
    expect(at(0) >= start && at(0) < end).toBe(true);
    expect(() => dayBounds("2026-9-1")).toThrow(/YYYY-MM-DD/);
  });

  it("replaces events per day and prefers call-link events on overlap", () => {
    const r = replaceCalendarEvents(t.db, [
      { externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: false },
      { externalId: "b", title: "Interview: Jane", startsAt: at(600), endsAt: at(2400), attendees: 2, hasCallLink: true },
    ]);
    expect(r.inserted).toBe(2);
    expect(findMeetingFor(t.db, at(700))?.externalId).toBe("b");
    expect(findMeetingFor(t.db, at(100))?.externalId).toBe("a");
    expect(findMeetingFor(t.db, at(5000))).toBeUndefined();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync (moved)", startsAt: at(0), endsAt: at(900), attendees: 4, hasCallLink: false }]);
    const rows = t.db.select().from(calendarEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Weekly sync (moved)");
  });

  it("labels meeting sessions on open and retroactively", () => {
    ingestHeartbeat(t.db, zoom(0));
    ingestHeartbeat(t.db, zoom(60));
    expect(t.db.select().from(activitySessions).get()?.meetingId).toBeNull();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Weekly sync", startsAt: at(0), endsAt: at(1800), attendees: 4, hasCallLink: true }]);
    const ev = t.db.select().from(calendarEvents).get()!;
    expect(t.db.select().from(activitySessions).get()?.meetingId).toBe(ev.id);
    ingestHeartbeat(t.db, { at: at(2000), appId: "com.microsoft.VSCode", appName: "Code", title: "x", url: null });
    ingestHeartbeat(t.db, zoom(2100));
    const s = t.db.select().from(activitySessions).all();
    expect(s[2].meetingId).toBeNull();
    expect(labelMeetings(t.db, [localDay(at(0))])).toBe(0);
  });

  it("detects interviews and captures a meeting item once", () => {
    expect(isInterview("Interview: Jane")).toBe(true);
    expect(isInterview("Weekly sync")).toBe(false);
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Interview: Jane", startsAt: at(0), endsAt: at(1800), attendees: 2, hasCallLink: true }]);
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    expect(item.type).toBe("meeting");
    expect(item.title).toBe("Interview: Jane");
    expect(parseMeta<{ calendarEventId: number }>(item).calendarEventId).toBe(ev.id);
    expect(item.body).toContain("2 attendees");
    expect(captureMeeting(t.db, ev.id).id).toBe(item.id);
    expect(() => captureMeeting(t.db, 999)).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/activity/calendar.test.ts`
Expected: FAIL, `replaceCalendarEvents` is not exported.

- [ ] **Step 3: Implement calendar.ts**

```ts
// src/domain/activity/calendar.ts
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents, items, type CalendarEvent, type Item } from "@/db/schema";
import { createItem } from "@/domain/items";
import { ActivityError, listCategories } from "./rules";

export interface CalendarEventInput {
  externalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: number;
  hasCallLink: boolean;
}

/** Local calendar day (YYYY-MM-DD) of an ISO timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight to next local midnight, as UTC ISO strings. */
export function dayBounds(day: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ActivityError("Day must be YYYY-MM-DD");
  const [y, m, d] = day.split("-").map(Number);
  return { start: new Date(y, m - 1, d).toISOString(), end: new Date(y, m - 1, d + 1).toISOString() };
}

export function isInterview(title: string): boolean {
  return /interview/i.test(title);
}

export function replaceCalendarEvents(db: DB, events: CalendarEventInput[]): { days: string[]; inserted: number } {
  const days = [...new Set(events.map((e) => localDay(e.startsAt)))];
  let inserted = 0;
  db.transaction((tx) => {
    if (days.length) tx.delete(calendarEvents).where(inArray(calendarEvents.day, days)).run();
    for (const e of events) {
      if (Date.parse(e.endsAt) <= Date.parse(e.startsAt)) continue;
      const values = {
        externalId: e.externalId,
        title: e.title.trim() || "Untitled event",
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        attendees: e.attendees,
        hasCallLink: e.hasCallLink ? 1 : 0,
        day: localDay(e.startsAt),
      };
      tx.insert(calendarEvents).values(values).onConflictDoUpdate({ target: calendarEvents.externalId, set: values }).run();
      inserted++;
    }
  });
  labelMeetings(db, days);
  return { days, inserted };
}

export function findMeetingFor(db: DB, at: string): CalendarEvent | undefined {
  return db
    .select()
    .from(calendarEvents)
    .where(and(lt(calendarEvents.startsAt, at), gt(calendarEvents.endsAt, at)))
    .orderBy(desc(calendarEvents.hasCallLink), asc(calendarEvents.startsAt))
    .get();
}

/** Attach events to unlabelled Meetings-category sessions on the given days. Returns rows changed. */
export function labelMeetings(db: DB, days: string[]): number {
  const meetings = listCategories(db).find((c) => c.name === "Meetings");
  if (!meetings || days.length === 0) return 0;
  let changed = 0;
  for (const day of days) {
    const { start, end } = dayBounds(day);
    const rows = db
      .select()
      .from(activitySessions)
      .where(
        and(
          eq(activitySessions.categoryId, meetings.id),
          isNull(activitySessions.meetingId),
          lt(activitySessions.startedAt, end),
          gt(activitySessions.endedAt, start),
        ),
      )
      .all();
    for (const s of rows) {
      const ev = findMeetingFor(db, s.startedAt) ?? findMeetingFor(db, s.endedAt);
      if (ev) {
        db.update(activitySessions).set({ meetingId: ev.id }).where(eq(activitySessions.id, s.id)).run();
        changed++;
      }
    }
  }
  return changed;
}

export function findCapturedMeetingItem(db: DB, eventId: number): Item | undefined {
  return db
    .select()
    .from(items)
    .where(sql`json_extract(${items.meta}, '$.calendarEventId') = ${eventId}`)
    .get();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function captureMeeting(db: DB, eventId: number): Item {
  const ev = db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!ev) throw new ActivityError("Meeting not found", 404);
  const existing = findCapturedMeetingItem(db, eventId);
  if (existing) return existing;
  const body = [
    `**When:** ${localDay(ev.startsAt)} ${fmtTime(ev.startsAt)} to ${fmtTime(ev.endsAt)}`,
    `**Who:** ${ev.attendees} attendees`,
    "",
    "## Notes",
    "",
    "## Actions",
    "",
    "- [ ] ",
  ].join("\n");
  return createItem(db, {
    type: "meeting",
    title: ev.title,
    body,
    status: "ready",
    meta: { calendarEventId: ev.id, interview: isInterview(ev.title) },
  });
}
```

- [ ] **Step 4: Run the calendar and sessions tests**

Run: `npx vitest run src/domain/activity/calendar.test.ts src/domain/activity/sessions.test.ts`
Expected: PASS (sessions tests still pass with the real `findMeetingFor`).

- [ ] **Step 5: Write the failing report test**

```ts
// src/domain/activity/report.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { getDay, getWeek, addDays } from "./report";
import { ingestHeartbeat } from "./sessions";
import { replaceCalendarEvents, captureMeeting, dayBounds } from "./calendar";
import { listCategories } from "./rules";
import { calendarEvents } from "@/db/schema";

describe("activity reports", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("totals a day by category, app, and site, clipped to the day", () => {
    const day = "2026-09-16";
    const { start, end } = dayBounds(day);
    const S = Date.parse(start);
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    ingestHeartbeat(t.db, { at: at(3600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 605), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 905), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 910), afk: true });
    ingestHeartbeat(t.db, { at: at(3600 + 1000), afk: true });
    const E = Date.parse(end);
    ingestHeartbeat(t.db, { at: new Date(E - 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });
    ingestHeartbeat(t.db, { at: new Date(E + 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });

    const d = getDay(t.db, day);
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    // Code 600s, Chrome 300s, afk 90s (excluded from active), Notes 60s inside the day; the two 5s hand-offs count too.
    expect(d.activeMs).toBe(600_000 + 5_000 + 300_000 + 5_000 + 60_000);
    const coding = d.byCategory.find((c) => c.categoryId === cats.Coding)!;
    expect(coding.ms).toBe(600_000 + 5_000 + 300_000 + 5_000);
    expect(d.byApp[0]).toMatchObject({ appId: "com.microsoft.VSCode" });
    expect(d.bySite.find((s) => s.key === "github.com")?.ms).toBe(305_000);
    expect(d.sessions.some((s) => s.afk)).toBe(true);
    expect(d.sessions.every((s) => s.startedAt >= start && s.endedAt <= end)).toBe(true);
  });

  it("reports meetings with scheduled versus actual minutes and capture state", () => {
    const day = "2026-09-16";
    const S = Date.parse(dayBounds(day).start) + 10 * 3600_000;
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Interview: Jane", startsAt: at(0), endsAt: at(1800), attendees: 2, hasCallLink: true }]);
    ingestHeartbeat(t.db, { at: at(60), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    ingestHeartbeat(t.db, { at: at(1260), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    let d = getDay(t.db, day);
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0]).toMatchObject({ title: "Interview: Jane", interview: true, scheduledMs: 1800_000, actualMs: 1200_000, itemId: null });
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    d = getDay(t.db, day);
    expect(d.meetings[0].itemId).toBe(item.id);
  });

  it("builds a week of daily category totals", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    const S = Date.parse(dayBounds("2026-09-14").start) + 9 * 3600_000;
    ingestHeartbeat(t.db, { at: new Date(S).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: new Date(S + 120_000).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const w = getWeek(t.db, "2026-09-14");
    expect(w.days).toHaveLength(7);
    expect(w.days[0].day).toBe("2026-09-14");
    expect(w.days[0].activeMs).toBe(120_000);
    expect(w.days[6].day).toBe("2026-09-20");
    expect(w.days[6].activeMs).toBe(0);
  });
});
```

- [ ] **Step 6: Implement report.ts**

```ts
// src/domain/activity/report.ts
import { and, asc, gt, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activitySessions, calendarEvents } from "@/db/schema";
import { dayBounds, findCapturedMeetingItem, isInterview } from "./calendar";

export interface DaySession {
  id: number;
  startedAt: string;
  endedAt: string;
  appId: string | null;
  appName: string | null;
  title: string | null;
  domain: string | null;
  categoryId: number | null;
  afk: boolean;
  meetingId: number | null;
}

export interface ActivityMeeting {
  id: number;
  title: string;
  startsAt: string;
  endsAt: string;
  attendees: number;
  hasCallLink: boolean;
  interview: boolean;
  scheduledMs: number;
  actualMs: number;
  itemId: number | null;
}

export interface ActivityDay {
  day: string;
  activeMs: number;
  sessions: DaySession[];
  byCategory: { categoryId: number | null; ms: number }[];
  byApp: { appId: string | null; appName: string | null; ms: number }[];
  bySite: { key: string; label: string; ms: number }[];
  meetings: ActivityMeeting[];
}

function clippedSessions(db: DB, day: string): DaySession[] {
  const { start, end } = dayBounds(day);
  return db
    .select()
    .from(activitySessions)
    .where(and(lt(activitySessions.startedAt, end), gt(activitySessions.endedAt, start)))
    .orderBy(asc(activitySessions.startedAt))
    .all()
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt < start ? start : s.startedAt,
      endedAt: s.endedAt > end ? end : s.endedAt,
      appId: s.appId,
      appName: s.appName,
      title: s.title,
      domain: s.domain,
      categoryId: s.categoryId,
      afk: s.afk === 1,
      meetingId: s.meetingId,
    }));
}

const ms = (s: DaySession) => Date.parse(s.endedAt) - Date.parse(s.startedAt);

function sumBy<K>(rows: DaySession[], key: (s: DaySession) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const s of rows) m.set(key(s), (m.get(key(s)) ?? 0) + ms(s));
  return m;
}

export function getDay(db: DB, day: string): ActivityDay {
  const sessions = clippedSessions(db, day);
  const active = sessions.filter((s) => !s.afk);
  const byCategory = [...sumBy(active, (s) => s.categoryId)].map(([categoryId, t]) => ({ categoryId, ms: t })).sort((a, b) => b.ms - a.ms);
  const appNames = new Map(active.map((s) => [s.appId, s.appName]));
  const byApp = [...sumBy(active, (s) => s.appId)]
    .map(([appId, t]) => ({ appId, appName: appNames.get(appId) ?? null, ms: t }))
    .sort((a, b) => b.ms - a.ms);
  const bySite = [...sumBy(active, (s) => s.domain ?? s.title ?? "")]
    .filter(([k]) => k !== "")
    .map(([key, t]) => ({ key, label: key, ms: t }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25);
  const { start, end } = dayBounds(day);
  const events = db
    .select()
    .from(calendarEvents)
    .where(and(lt(calendarEvents.startsAt, end), gt(calendarEvents.endsAt, start)))
    .orderBy(asc(calendarEvents.startsAt))
    .all();
  const meetings: ActivityMeeting[] = events.map((ev) => ({
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    attendees: ev.attendees,
    hasCallLink: ev.hasCallLink === 1,
    interview: isInterview(ev.title),
    scheduledMs: Date.parse(ev.endsAt) - Date.parse(ev.startsAt),
    actualMs: active.filter((s) => s.meetingId === ev.id).reduce((a, s) => a + ms(s), 0),
    itemId: findCapturedMeetingItem(db, ev.id)?.id ?? null,
  }));
  return { day, activeMs: active.reduce((a, s) => a + ms(s), 0), sessions, byCategory, byApp, bySite, meetings };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function getWeek(db: DB, start: string): { start: string; days: { day: string; activeMs: number; byCategory: ActivityDay["byCategory"] }[] } {
  dayBounds(start); // validates the format
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
    const d = getDay(db, day);
    return { day, activeMs: d.activeMs, byCategory: d.byCategory };
  });
  return { start, days };
}
```

Update `src/domain/activity/index.ts` to also `export * from "./report";`.

- [ ] **Step 7: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/domain/activity
git commit -m "feat(activity): calendar events, meeting labels, day and week reports

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 4: API routes, helper token, prune on backup

**Files:**
- Create: `src/lib/activity-auth.ts`, `src/domain/activity/helper-state.ts`
- Create: `src/app/api/activity/heartbeat/route.ts`, `calendar/route.ts`, `day/route.ts`, `week/route.ts`, `rules/route.ts`, `rules/[id]/route.ts`, `rules/reorder/route.ts`, `exclusions/route.ts`, `exclusions/[id]/route.ts`, `categories/route.ts`, `categories/[id]/route.ts`, `pause/route.ts`, `sessions/[id]/label/route.ts`, `meetings/[id]/capture/route.ts`
- Modify: `src/lib/api.ts` (`errorResponse` handles `ActivityError`), `src/lib/dto.ts`, `src/lib/paths.ts` (`activityTokenPath()`), `src/jobs/handlers/backup.ts` (prune after backup), `src/domain/activity/index.ts`
- Test: `src/app/api/activity.test.ts`, `src/jobs/handlers/backup.test.ts` (one added case)

**Interfaces:**
- Consumes: Tasks 2 and 3; `getSetting`/`setSetting`; `parseId`, `errorResponse`, `serializeItem`.
- Produces:
  - `activityTokenPath(): string` = `path.join(dataDir(), "activity-token")`
  - `readHelperToken(): string | null` (re-read when the file's mtime changes), `requireHelperToken(req): NextResponse | null`
  - `helper-state.ts`: `HelperState`, `getHelperState(db)`, `recordHelperSeen(db, at, helper?)`, `isPaused(db)`, `setPaused(db, paused)`, `retentionDays(db)`, `setRetentionDays(db, days)`; settings keys `activity_paused` ('0'|'1'), `activity_retention_days` (default '90'), `activity_helper_state` (JSON)
  - DTOs listed in Step 3.
  - Heartbeat body (zod): `{ at, afk?, paused?, appId?, appName?, title?, url?, idleSeconds?, helper?: { version, permissions: { accessibility, calendar, automation: Record<string, boolean> } } }`. Response `{ exclusions: { apps: string[]; domains: string[] }, paused: boolean }`. `idleSeconds >= AFK_SECONDS` is treated as `afk`. Helper state and `lastSeen = at` are stored on every call. Nothing is ingested while paused (setting or body flag).

- [ ] **Step 1: Write the failing API test**

```ts
// src/app/api/activity.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: {
  heartbeat: typeof import("./activity/heartbeat/route");
  calendar: typeof import("./activity/calendar/route");
  day: typeof import("./activity/day/route");
  week: typeof import("./activity/week/route");
  rules: typeof import("./activity/rules/route");
  rule: typeof import("./activity/rules/[id]/route");
  reorder: typeof import("./activity/rules/reorder/route");
  exclusions: typeof import("./activity/exclusions/route");
  pause: typeof import("./activity/pause/route");
  capture: typeof import("./activity/meetings/[id]/capture/route");
  label: typeof import("./activity/sessions/[id]/label/route");
};
const TOKEN = "abc123";
const T0 = new Date(2026, 8, 16, 10, 0, 0).getTime(); // local 10:00 so every heartbeat lands on the same local day
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const day = "2026-09-16";

const json = (method: string, url: string, body?: unknown, token?: string) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  fs.writeFileSync(path.join(dir, "activity-token"), TOKEN + "\n");
  r = {
    heartbeat: await import("./activity/heartbeat/route"),
    calendar: await import("./activity/calendar/route"),
    day: await import("./activity/day/route"),
    week: await import("./activity/week/route"),
    rules: await import("./activity/rules/route"),
    rule: await import("./activity/rules/[id]/route"),
    reorder: await import("./activity/rules/reorder/route"),
    exclusions: await import("./activity/exclusions/route"),
    pause: await import("./activity/pause/route"),
    capture: await import("./activity/meetings/[id]/capture/route"),
    label: await import("./activity/sessions/[id]/label/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const getDay = async () => (await (await r.day.GET(json("GET", `/api/activity/day?date=${day}`))).json()) as Record<string, any>;

describe("activity api", () => {
  it("rejects heartbeats without the token", async () => {
    const res = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(0), appId: "x" }));
    expect(res.status).toBe(401);
    const bad = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(0), appId: "x" }, "nope"));
    expect(bad.status).toBe(401);
  });

  it("ingests heartbeats, returns exclusions, stores helper state", async () => {
    const body = {
      at: at(0), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null, idleSeconds: 1,
      helper: { version: "1.0.0", permissions: { accessibility: true, calendar: false, automation: {} } },
    };
    const res = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", body, TOKEN));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exclusions.apps).toContain("com.1password.1password");
    expect(data.paused).toBe(false);
    await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { ...body, at: at(300) }, TOKEN));
    await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(305), appId: "x", appName: "x", title: null, url: null, idleSeconds: 400 }, TOKEN));
    const d = await getDay();
    expect(d.activeMs).toBe(305_000);
    expect(d.helper.permissions.accessibility).toBe(true);
    expect(d.helper.lastSeen).toBe(at(305));
    expect(d.sessions).toHaveLength(2);
    expect(d.retentionDays).toBe(90);
  });

  it("pauses, resumes, and sets retention", async () => {
    let res = await r.pause.POST(json("POST", "/api/activity/pause", { paused: true }));
    expect((await res.json()).paused).toBe(true);
    const hb = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(600), appId: "com.microsoft.VSCode", appName: "Code", title: "b", url: null }, TOKEN));
    expect((await hb.json()).paused).toBe(true);
    expect((await getDay()).sessions).toHaveLength(2);
    res = await r.pause.POST(json("POST", "/api/activity/pause", { paused: false, retentionDays: 30 }));
    expect(await res.json()).toEqual({ paused: false, retentionDays: 30 });
    expect((await getDay()).retentionDays).toBe(30);
  });

  it("replaces calendar events and captures a meeting once", async () => {
    const res = await r.calendar.POST(json("POST", "/api/activity/calendar", { events: [{ externalId: "e1", title: "Interview: Jane", startsAt: at(1000), endsAt: at(2800), attendees: 2, hasCallLink: true }] }, TOKEN));
    expect(res.status).toBe(200);
    const d = await getDay();
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0].interview).toBe(true);
    const c1 = await r.capture.POST(json("POST", "/x"), params(d.meetings[0].id));
    expect(c1.status).toBe(201);
    const c2 = await r.capture.POST(json("POST", "/x"), params(d.meetings[0].id));
    expect(c2.status).toBe(200);
    expect((await c1.json()).id).toBe((await c2.json()).id);
  });

  it("manages rules, reorders, and recategorises", async () => {
    const list = (await (await r.rules.GET()).json()) as { id: number }[];
    const cats = (await getDay()).categories as { id: number; name: string }[];
    const writing = cats.find((c) => c.name === "Writing")!.id;
    const created = await r.rules.POST(json("POST", "/api/activity/rules", { matchKind: "app", pattern: "com.microsoft.VSCode", categoryId: writing }));
    expect(created.status).toBe(201);
    const rule = (await created.json()) as { id: number };
    await r.reorder.POST(json("POST", "/api/activity/rules/reorder", { ids: [rule.id, ...list.map((x) => x.id)] }));
    const d = await getDay();
    expect(d.byCategory[0].categoryId).toBe(writing);
    const bad = await r.rules.POST(json("POST", "/api/activity/rules", { matchKind: "nope", pattern: "x", categoryId: writing }));
    expect(bad.status).toBe(400);
    const del = await r.rule.DELETE(json("DELETE", "/x"), params(rule.id));
    expect(del.status).toBe(204);
  });

  it("adds and rejects duplicate exclusions", async () => {
    const ok = await r.exclusions.POST(json("POST", "/api/activity/exclusions", { kind: "domain", pattern: "secret.example" }));
    expect(ok.status).toBe(201);
    const dup = await r.exclusions.POST(json("POST", "/api/activity/exclusions", { kind: "domain", pattern: "secret.example" }));
    expect(dup.status).toBe(409);
  });

  it("labels a session and serves a week", async () => {
    const d = await getDay();
    const leisure = (d.categories as { id: number; name: string }[]).find((c) => c.name === "Leisure")!.id;
    const res = await r.label.POST(json("POST", "/x", { categoryId: leisure }), params(d.sessions[0].id));
    expect(res.status).toBe(200);
    const w = (await (await r.week.GET(json("GET", `/api/activity/week?start=${day}`))).json()) as { days: { day: string }[] };
    expect(w.days).toHaveLength(7);
    const badDay = await r.day.GET(json("GET", "/api/activity/day?date=2026-9-1"));
    expect(badDay.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/activity.test.ts`
Expected: FAIL, cannot find the route modules.

- [ ] **Step 3: Token helper, paths, helper state, error mapping, DTOs**

```ts
// src/lib/paths.ts  (append)
export function activityTokenPath(): string {
  return path.join(dataDir(), "activity-token");
}
```

```ts
// src/lib/activity-auth.ts
import fs from "node:fs";
import { NextResponse } from "next/server";
import { activityTokenPath } from "./paths";

let cache: { path: string; mtimeMs: number; token: string } | null = null;

export function readHelperToken(): string | null {
  const p = activityTokenPath();
  try {
    const st = fs.statSync(p);
    if (!cache || cache.path !== p || cache.mtimeMs !== st.mtimeMs) {
      cache = { path: p, mtimeMs: st.mtimeMs, token: fs.readFileSync(p, "utf8").trim() };
    }
    return cache.token || null;
  } catch {
    return null;
  }
}

/** 401 response when the bearer token is missing or wrong; null when the request is authorised. */
export function requireHelperToken(req: Request): NextResponse | null {
  const expected = readHelperToken();
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || !given || given !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
```

```ts
// src/domain/activity/helper-state.ts
import type { DB } from "@/db/client";
import { getSetting, setSetting } from "@/domain/settings";
import { ActivityError } from "./rules";

export interface HelperState {
  lastSeen: string | null;
  version: string | null;
  permissions: { accessibility: boolean; calendar: boolean; automation: Record<string, boolean> } | null;
}

const EMPTY: HelperState = { lastSeen: null, version: null, permissions: null };

export function getHelperState(db: DB): HelperState {
  try {
    return { ...EMPTY, ...(JSON.parse(getSetting(db, "activity_helper_state", "{}")) as Partial<HelperState>) };
  } catch {
    return EMPTY;
  }
}

export function recordHelperSeen(db: DB, at: string, helper?: { version: string; permissions: HelperState["permissions"] }): void {
  const prev = getHelperState(db);
  setSetting(
    db,
    "activity_helper_state",
    JSON.stringify({ lastSeen: at, version: helper?.version ?? prev.version, permissions: helper?.permissions ?? prev.permissions }),
  );
}

export function isPaused(db: DB): boolean {
  return getSetting(db, "activity_paused", "0") === "1";
}

export function setPaused(db: DB, paused: boolean): void {
  setSetting(db, "activity_paused", paused ? "1" : "0");
}

export function retentionDays(db: DB): number {
  const n = Number(getSetting(db, "activity_retention_days", "90"));
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function setRetentionDays(db: DB, days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ActivityError("Retention must be between 1 and 3650 days");
  setSetting(db, "activity_retention_days", String(days));
}
```

Add `export * from "./helper-state";` to `src/domain/activity/index.ts`.

In `src/lib/api.ts`, import `ActivityError` from `@/domain/activity/rules` and add it to the `instanceof` chain in `errorResponse` next to `PersonError`.

Add to `src/lib/dto.ts`:

```ts
export interface ActivityCategoryDTO { id: number; name: string; color: string; sortOrder: number }
export interface ActivityRuleDTO { id: number; matchKind: "app" | "domain" | "title_contains"; pattern: string; categoryId: number; sortOrder: number }
export interface ActivityExclusionDTO { id: number; kind: "app" | "domain"; pattern: string }
export interface HelperStateDTO {
  lastSeen: string | null;
  version: string | null;
  permissions: { accessibility: boolean; calendar: boolean; automation: Record<string, boolean> } | null;
}
export interface ActivitySessionDTO {
  id: number; startedAt: string; endedAt: string; appId: string | null; appName: string | null; title: string | null;
  domain: string | null; categoryId: number | null; afk: boolean; meetingId: number | null;
}
export interface ActivityMeetingDTO {
  id: number; title: string; startsAt: string; endsAt: string; attendees: number; hasCallLink: boolean; interview: boolean;
  scheduledMs: number; actualMs: number; itemId: number | null;
}
export interface ActivityDayDTO {
  day: string;
  activeMs: number;
  sessions: ActivitySessionDTO[];
  byCategory: { categoryId: number | null; ms: number }[];
  byApp: { appId: string | null; appName: string | null; ms: number }[];
  bySite: { key: string; label: string; ms: number }[];
  meetings: ActivityMeetingDTO[];
  categories: ActivityCategoryDTO[];
  helper: HelperStateDTO;
  paused: boolean;
  retentionDays: number;
}
export interface ActivityWeekDTO {
  start: string;
  days: { day: string; activeMs: number; byCategory: { categoryId: number | null; ms: number }[] }[];
  categories: ActivityCategoryDTO[];
}
```

- [ ] **Step 4: Routes**

`src/app/api/activity/heartbeat/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { AFK_SECONDS, ingestHeartbeat, isPaused, listExclusions, recordHelperSeen } from "@/domain/activity";
import { requireHelperToken } from "@/lib/activity-auth";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp"),
  afk: z.boolean().optional(),
  paused: z.boolean().optional(),
  appId: z.string().nullable().optional(),
  appName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  idleSeconds: z.number().nonnegative().optional(),
  helper: z
    .object({
      version: z.string(),
      permissions: z.object({ accessibility: z.boolean(), calendar: z.boolean(), automation: z.record(z.string(), z.boolean()) }),
    })
    .optional(),
});

export async function POST(req: Request): Promise<Response> {
  const denied = requireHelperToken(req);
  if (denied) return denied;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const hb = parsed.data;
    recordHelperSeen(db, hb.at, hb.helper);
    const paused = isPaused(db);
    if (!paused && !hb.paused) {
      const afk = hb.afk === true || (hb.idleSeconds ?? 0) >= AFK_SECONDS;
      ingestHeartbeat(db, { at: hb.at, afk, appId: hb.appId, appName: hb.appName, title: hb.title, url: hb.url });
    }
    const ex = listExclusions(db);
    return NextResponse.json({
      exclusions: {
        apps: ex.filter((e) => e.kind === "app").map((e) => e.pattern),
        domains: ex.filter((e) => e.kind === "domain").map((e) => e.pattern),
      },
      paused,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`calendar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { replaceCalendarEvents } from "@/domain/activity";
import { requireHelperToken } from "@/lib/activity-auth";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp");
const Body = z.object({
  events: z.array(
    z.object({
      externalId: z.string().min(1),
      title: z.string(),
      startsAt: Iso,
      endsAt: Iso,
      attendees: z.number().int().nonnegative().default(0),
      hasCallLink: z.boolean().default(false),
    }),
  ),
});

export async function POST(req: Request): Promise<Response> {
  const denied = requireHelperToken(req);
  if (denied) return denied;
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(replaceCalendarEvents(getDb(), parsed.data.events));
  } catch (err) {
    return errorResponse(err);
  }
}
```

`day/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ActivityError, getDay, getHelperState, isPaused, listCategories, retentionDays } from "@/domain/activity";
import { errorResponse } from "@/lib/api";
import type { ActivityDayDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ActivityError("date must be YYYY-MM-DD");
    const db = getDb();
    const dto: ActivityDayDTO = {
      ...getDay(db, date),
      categories: listCategories(db),
      helper: getHelperState(db),
      paused: isPaused(db),
      retentionDays: retentionDays(db),
    };
    return NextResponse.json(dto);
  } catch (err) {
    return errorResponse(err);
  }
}
```

`week/route.ts`: same shape reading `start`, returning `{ ...getWeek(db, start), categories: listCategories(db) }` as `ActivityWeekDTO`.

`rules/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createRule, listRules, recategorise } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  matchKind: z.enum(["app", "domain", "title_contains"]),
  pattern: z.string().min(1),
  categoryId: z.number().int().positive(),
});

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listRules(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const rule = createRule(db, parsed.data);
    recategorise(db, 30);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`rules/[id]/route.ts`: `PATCH` with `Body.partial()` of the same shape then `updateRule` + `recategorise(db, 30)`; `DELETE` calls `deleteRule` + `recategorise(db, 30)` and returns 204. Both use `parseId((await ctx.params).id)` with `type Ctx = { params: Promise<{ id: string }> }`.

`rules/reorder/route.ts`: `POST { ids: z.array(z.number().int().positive()) }` calls `reorderRules` then `recategorise(db, 30)` and returns the list.

`exclusions/route.ts`: `GET` list; `POST { kind: z.enum(["app","domain"]), pattern: z.string().min(1) }` returns 201. `exclusions/[id]/route.ts`: `DELETE` returns 204.

`categories/route.ts`: `GET`. `categories/[id]/route.ts`: `PATCH { name?: z.string().min(1), color?: z.string() }`.

`pause/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { isPaused, retentionDays, setPaused, setRetentionDays } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ paused: z.boolean().optional(), retentionDays: z.number().int().optional() });

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    if (parsed.data.paused !== undefined) setPaused(db, parsed.data.paused);
    if (parsed.data.retentionDays !== undefined) setRetentionDays(db, parsed.data.retentionDays);
    return NextResponse.json({ paused: isPaused(db), retentionDays: retentionDays(db) });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`sessions/[id]/label/route.ts`: `POST { categoryId: z.number().int().positive().nullable().optional(), meetingId: z.number().int().positive().nullable().optional() }` calls `labelSession` and returns the row.

`meetings/[id]/capture/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { captureMeeting, findCapturedMeetingItem } from "@/domain/activity";
import { errorResponse, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const db = getDb();
    const existed = !!findCapturedMeetingItem(db, id);
    const item = captureMeeting(db, id);
    return NextResponse.json(serializeItem(db, item), { status: existed ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: Prune on backup**

In `src/jobs/handlers/backup.ts`, after `pruneOldBackups(dir, KEEP)`, add:

```ts
const pruned = pruneActivity(deps.db, retentionDays(deps.db));
if (pruned.sessions || pruned.events) console.log(`[backup] pruned ${pruned.sessions} activity session(s), ${pruned.events} event(s)`);
```

with `import { pruneActivity, retentionDays } from "@/domain/activity";`. Add one case to `src/jobs/handlers/backup.test.ts`: ingest a heartbeat dated 100 days ago and one dated now through `ingestHeartbeat`, run the handler, assert only the recent session remains.

- [ ] **Step 6: Run tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/activity src/app/api/activity.test.ts src/lib src/domain/activity src/jobs/handlers/backup.ts src/jobs/handlers/backup.test.ts
git commit -m "feat(activity): api routes with helper token, prune on backup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 5: Swift helper and lifecycle script

**Files:**
- Create: `helper/activity/Package.swift`, `helper/activity/Sources/sb-activity/main.swift`, `Sampler.swift`, `CalendarReader.swift`, `Client.swift`
- Modify: `scripts/brain.sh`, `.gitignore`, `README.md`

**Interfaces:**
- Consumes: `POST /api/activity/heartbeat` and `/calendar` contracts from Task 4; `DATA_DIR/activity-token`; `EXCLUDED_APP_ID = "excluded"`.
- Produces: binary `sb-activity` with flags `--once` (print one sample and permission state as JSON; exit 0 when Accessibility and Calendar are granted, 2 otherwise) and `--server URL` (default `http://127.0.0.1:3141`); env `SB_DATA_DIR`.

- [ ] **Step 1: Package manifest**

```swift
// helper/activity/Package.swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "sb-activity",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "sb-activity", path: "Sources/sb-activity")
    ]
)
```

- [ ] **Step 2: Sampler**

```swift
// helper/activity/Sources/sb-activity/Sampler.swift
import AppKit
import ApplicationServices
import Foundation

struct Sample: Encodable {
    var at: String
    var appId: String?
    var appName: String?
    var title: String?
    var url: String?
    var idleSeconds: Double
}

struct Permissions: Encodable {
    var accessibility: Bool
    var calendar: Bool
    var automation: [String: Bool]
}

enum Browser: String, CaseIterable {
    case chrome = "com.google.Chrome"
    case arc = "company.thebrowser.Browser"
    case brave = "com.brave.Browser"
    case edge = "com.microsoft.edgemac"
    case safari = "com.apple.Safari"

    var script: String {
        switch self {
        case .safari:
            return "tell application id \"com.apple.Safari\" to get URL of front document"
        default:
            return "tell application id \"\(rawValue)\" to get URL of active tab of front window"
        }
    }
}

final class Sampler {
    private(set) var automation: [String: Bool] = [:]
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var accessibilityTrusted: Bool { AXIsProcessTrusted() }

    func promptAccessibility() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        AXIsProcessTrustedWithOptions(opts)
    }

    func idleSeconds() -> Double {
        // ~0 is kCGAnyInputEventType.
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }

    func sample(now: Date = Date()) -> Sample {
        var s = Sample(at: iso.string(from: now), idleSeconds: idleSeconds())
        guard let app = NSWorkspace.shared.frontmostApplication else { return s }
        s.appId = app.bundleIdentifier
        s.appName = app.localizedName
        if accessibilityTrusted { s.title = focusedWindowTitle(pid: app.processIdentifier) }
        if let id = app.bundleIdentifier, let browser = Browser(rawValue: id) { s.url = browserURL(browser) }
        return s
    }

    private func focusedWindowTitle(pid: pid_t) -> String? {
        let appEl = AXUIElementCreateApplication(pid)
        var win: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute as CFString, &win) == .success, let w = win else { return nil }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(w as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else { return nil }
        return title as? String
    }

    private func browserURL(_ b: Browser) -> String? {
        var err: NSDictionary?
        guard let script = NSAppleScript(source: b.script) else { return nil }
        let out = script.executeAndReturnError(&err)
        if let err, let code = err[NSAppleScript.errorNumber] as? Int {
            // -1743 means Automation was denied for this browser; other codes are transient (no window, no document).
            automation[b.rawValue] = code != -1743
            return nil
        }
        automation[b.rawValue] = true
        return out.stringValue
    }
}
```

- [ ] **Step 3: Calendar reader**

```swift
// helper/activity/Sources/sb-activity/CalendarReader.swift
import EventKit
import Foundation

struct EventPayload: Encodable {
    var externalId: String
    var title: String
    var startsAt: String
    var endsAt: String
    var attendees: Int
    var hasCallLink: Bool
}

final class CalendarReader {
    private let store = EKEventStore()
    private(set) var granted = false
    private let iso = ISO8601DateFormatter()
    private let callRe = try! NSRegularExpression(pattern: "(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)", options: .caseInsensitive)

    func requestAccess() {
        let sem = DispatchSemaphore(value: 0)
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in self.granted = ok; sem.signal() }
        } else {
            store.requestAccess(to: .event) { ok, _ in self.granted = ok; sem.signal() }
        }
        _ = sem.wait(timeout: .now() + 30)
    }

    /// Today's and tomorrow's timed events.
    func upcoming(now: Date = Date()) -> [EventPayload] {
        guard granted else { return [] }
        let cal = Foundation.Calendar.current
        let start = cal.startOfDay(for: now)
        let end = cal.date(byAdding: .day, value: 2, to: start)!
        let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        return store.events(matching: pred).filter { !$0.isAllDay }.map { e in
            let text = [e.location, e.url?.absoluteString, e.notes].compactMap { $0 }.joined(separator: " ")
            let hasCall = callRe.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
            return EventPayload(
                externalId: e.eventIdentifier ?? "\(e.calendarItemIdentifier)-\(iso.string(from: e.startDate))",
                title: e.title ?? "",
                startsAt: iso.string(from: e.startDate),
                endsAt: iso.string(from: e.endDate),
                attendees: e.attendees?.count ?? 0,
                hasCallLink: hasCall)
        }
    }
}
```

- [ ] **Step 4: Client and main loop**

```swift
// helper/activity/Sources/sb-activity/Client.swift
import Foundation

struct HeartbeatResponse: Decodable {
    struct Exclusions: Decodable { var apps: [String]; var domains: [String] }
    var exclusions: Exclusions
    var paused: Bool
}

final class Client {
    let base: URL
    let token: String
    private let session = URLSession(configuration: .ephemeral)

    init(base: URL, token: String) { self.base = base; self.token = token }

    /// Synchronous POST; returns (status, body) or nil when the server is unreachable.
    func post(_ path: String, json: Data) -> (Int, Data)? {
        var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = json
        let sem = DispatchSemaphore(value: 0)
        var result: (Int, Data)?
        session.dataTask(with: req) { data, resp, _ in
            if let http = resp as? HTTPURLResponse { result = (http.statusCode, data ?? Data()) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 6)
        return result
    }
}
```

```swift
// helper/activity/Sources/sb-activity/main.swift
import Foundation

let VERSION = "1.0.0"
let SAMPLE_INTERVAL: TimeInterval = 5
let CALENDAR_INTERVAL: TimeInterval = 60
let RETRY_INTERVAL: TimeInterval = 30
let AFK_SECONDS: Double = 180
let MAX_BUFFER = 12 * 60 * 60 / 5  // 12 hours of heartbeats
let EXCLUDED_APP_ID = "excluded"

struct Heartbeat: Encodable {
    var at: String
    var afk: Bool?
    var appId: String?
    var appName: String?
    var title: String?
    var url: String?
    var idleSeconds: Double?
    var paused: Bool?
    var helper: HelperInfo?
}
struct HelperInfo: Encodable { var version: String; var permissions: Permissions }

let args = CommandLine.arguments
let once = args.contains("--once")
var serverURL = URL(string: "http://127.0.0.1:3141")!
if let i = args.firstIndex(of: "--server"), i + 1 < args.count, let u = URL(string: args[i + 1]) { serverURL = u }

let dataDir = ProcessInfo.processInfo.environment["SB_DATA_DIR"]
    ?? ("\(NSHomeDirectory())/Library/Application Support/second-brain")
let tokenPath = "\(dataDir)/activity-token"

let sampler = Sampler()
let calendar = CalendarReader()
let encoder = JSONEncoder()

func log(_ s: String) { FileHandle.standardError.write("[sb-activity] \(s)\n".data(using: .utf8)!) }

func currentPermissions() -> Permissions {
    Permissions(accessibility: sampler.accessibilityTrusted, calendar: calendar.granted, automation: sampler.automation)
}

if once {
    sampler.promptAccessibility()
    calendar.requestAccess()
    let s = sampler.sample()
    let p = currentPermissions()
    struct Out: Encodable { var sample: Sample; var permissions: Permissions }
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(data: try! encoder.encode(Out(sample: s, permissions: p)), encoding: .utf8)!)
    exit(p.accessibility && p.calendar ? 0 : 2)
}

guard let token = try? String(contentsOfFile: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
    log("no token at \(tokenPath); run scripts/brain.sh setup")
    exit(1)
}
let client = Client(base: serverURL, token: token)

sampler.promptAccessibility()
calendar.requestAccess()

var buffer: [Data] = []
var exclusions = HeartbeatResponse.Exclusions(apps: [], domains: [])
var paused = false
var lastCalendar = Date.distantPast
var lastRetry = Date.distantPast
var lastHelperInfo = Date.distantPast
var lastPausedPing = Date.distantPast

func excluded(_ s: Sample) -> Bool {
    if let id = s.appId, exclusions.apps.contains(id) { return true }
    guard let u = s.url, let host = URL(string: u)?.host?.lowercased() else { return false }
    let h = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    return exclusions.domains.contains { p in
        let p = p.lowercased()
        if p.hasPrefix("*.") { return h.hasSuffix(String(p.dropFirst(1))) }
        return h == p || h.hasSuffix("." + p)
    }
}

func flush() {
    while let first = buffer.first {
        guard let (status, body) = client.post("/api/activity/heartbeat", json: first) else { return }
        buffer.removeFirst()
        if status == 200, let r = try? JSONDecoder().decode(HeartbeatResponse.self, from: body) {
            exclusions = r.exclusions
            paused = r.paused
        } else if status == 401 {
            log("server rejected the token (401)")
        }
    }
}

func tick() {
    let now = Date()
    let s = sampler.sample(now: now)
    var hb = Heartbeat(at: s.at, idleSeconds: s.idleSeconds)
    if now.timeIntervalSince(lastHelperInfo) > 60 {
        hb.helper = HelperInfo(version: VERSION, permissions: currentPermissions())
        lastHelperInfo = now
    }
    if paused {
        // One light heartbeat a minute keeps "last seen" fresh and notices when recording resumes.
        if now.timeIntervalSince(lastPausedPing) < 60 { return }
        lastPausedPing = now
        hb.paused = true
    } else if s.idleSeconds >= AFK_SECONDS {
        hb.afk = true
    } else if excluded(s) {
        // Drop the sample locally; a placeholder app id lets the server close the previous session.
        hb.appId = EXCLUDED_APP_ID
        hb.appName = "Excluded"
    } else {
        hb.appId = s.appId
        hb.appName = s.appName
        hb.title = s.title
        hb.url = s.url
    }
    if let data = try? encoder.encode(hb) {
        buffer.append(data)
        if buffer.count > MAX_BUFFER { buffer.removeFirst(buffer.count - MAX_BUFFER) }
    }
    if buffer.count == 1 || now.timeIntervalSince(lastRetry) >= RETRY_INTERVAL {
        flush()
        if !buffer.isEmpty { lastRetry = now }
    }
    if now.timeIntervalSince(lastCalendar) >= CALENDAR_INTERVAL {
        lastCalendar = now
        let events = calendar.upcoming(now: now)
        if let data = try? encoder.encode(["events": events]) { _ = client.post("/api/activity/calendar", json: data) }
    }
}

log("started, server \(serverURL), data \(dataDir)")
let timer = Timer(timeInterval: SAMPLE_INTERVAL, repeats: true) { _ in tick() }
RunLoop.main.add(timer, forMode: .common)
tick()
RunLoop.main.run()
```

- [ ] **Step 5: brain.sh**

Edits to `scripts/brain.sh`:

1. After the `PLIST=` line add:

```bash
HELPER_LABEL="com.second-brain.activity"
HELPER_PLIST="$HOME/Library/LaunchAgents/$HELPER_LABEL.plist"
HELPER_SRC="$ROOT/helper/activity"
HELPER_BIN="$DATA_DIR/bin/sb-activity"
HELPER_LOG="$LOG_DIR/activity.log"
TOKEN_FILE="$DATA_DIR/activity-token"
```

2. After `wait_for_server` add:

```bash
helper_loaded() { launchctl print "$DOMAIN/$HELPER_LABEL" >/dev/null 2>&1; }

ensure_token() {
  if [ ! -s "$TOKEN_FILE" ]; then
    mkdir -p "$DATA_DIR"
    (umask 077; head -c 32 /dev/urandom | xxd -p -c 64 > "$TOKEN_FILE")
    ok "activity token written"
  fi
}

build_helper() {
  if ! command -v swift >/dev/null; then
    say "swift not found; skipping the activity helper. Install the Xcode command line tools and rerun setup to enable it."
    return 1
  fi
  say "building the activity helper"
  (cd "$HELPER_SRC" && swift build -c release 2>&1 | tail -3)
  mkdir -p "$(dirname "$HELPER_BIN")"
  cp "$HELPER_SRC/.build/release/sb-activity" "$HELPER_BIN"
  ok "helper built at $HELPER_BIN"
}

write_helper_plist() {
  cat > "$HELPER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$HELPER_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HELPER_BIN</string>
    <string>--server</string>
    <string>$URL</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SB_DATA_DIR</key><string>$DATA_DIR</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HELPER_LOG</string>
  <key>StandardErrorPath</key><string>$HELPER_LOG</string>
</dict>
</plist>
PLIST
  ok "helper launch agent written to $HELPER_PLIST"
}

helper_start() {
  if [ ! -f "$HELPER_PLIST" ] || [ ! -x "$HELPER_BIN" ]; then
    say "activity helper not installed (run setup with swift available)"
    return 0
  fi
  if helper_loaded; then say "helper already loaded"; else launchctl bootstrap "$DOMAIN" "$HELPER_PLIST"; ok "helper loaded"; fi
}

helper_stop() {
  if helper_loaded; then launchctl bootout "$DOMAIN/$HELPER_LABEL" || true; ok "helper stopped"; fi
}

helper_status() {
  if helper_loaded; then ok "activity helper loaded"; else say "activity helper not loaded"; fi
  if [ -x "$HELPER_BIN" ]; then
    local out
    out="$(SB_DATA_DIR="$DATA_DIR" "$HELPER_BIN" --once 2>/dev/null || true)"
    if [ -n "$out" ]; then
      printf '%s' "$out" | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { const p = JSON.parse(s).permissions;
            console.log(`  accessibility: ${p.accessibility ? "granted" : "missing"}  calendar: ${p.calendar ? "granted" : "missing"}`);
          } catch { console.log("  helper check failed"); }
        });'
    fi
  fi
}
```

3. In `cmd_setup`, after `download_model`: `ensure_token` then `if build_helper; then write_helper_plist; fi`. In `cmd_start`, after the server is confirmed up: `helper_start`. In `cmd_stop`, before the app agent is unloaded: `helper_stop`. In `cmd_status`, at the end: `helper_status`. In `usage`, extend the `setup` line with "and the activity helper".

4. `.gitignore`: add `helper/activity/.build/`.

5. README: add an "Activity tracking" section after "How things are organised" covering: what is recorded (frontmost app, window title, browser URL for Chrome, Arc, Brave, Edge, Safari, away time after 3 minutes idle, calendar events for today and tomorrow); the three permissions (Accessibility, Automation per browser, Calendars) and that macOS asks on first run; the pre-seeded exclusions and how to add more in the Rules drawer; Pause; retention (90 days by default, pruned nightly); and how to uninstall (`scripts/brain.sh stop`, `launchctl bootout gui/$(id -u)/com.second-brain.activity`, delete `~/Library/LaunchAgents/com.second-brain.activity.plist` and `DATA_DIR/bin/sb-activity`).

- [ ] **Step 6: Build the helper and check**

Run: `cd helper/activity && swift build -c release 2>&1 | tail -3 && .build/release/sb-activity --once; echo "exit $?"`
Expected: JSON with a sample and permissions; exit 0 or 2 depending on grants (both acceptable). If `swift` is missing on the machine, record that in the report and skip; the TypeScript side is unaffected.

- [ ] **Step 7: Run tests, lint, build, and a shell syntax check; commit**

Run: `npm test && npm run lint && npm run build && bash -n scripts/brain.sh`

```bash
git add helper/activity scripts/brain.sh .gitignore README.md
git commit -m "feat(activity): swift helper, launch agent, and lifecycle script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 6: Activity page, day view, dock entry

**Files:**
- Modify: `src/components/nav.ts`, `src/components/icons.tsx`, `src/components/dock.tsx`
- Create: `src/app/activity/page.tsx`, `src/components/activity/activity-page.tsx`, `timeline.tsx`, `totals.tsx`, `meetings.tsx`, `status-strip.tsx`, `format.ts`
- Test: `src/components/activity/format.test.ts`

**Interfaces:**
- Consumes: `GET /api/activity/day`, `POST /api/activity/pause`, `POST /api/activity/sessions/[id]/label`, `POST /api/activity/meetings/[id]/capture`; DTOs from Task 4.
- Produces: `todayLocal()`, `formatDuration(ms)`, `fractionOfDay(iso, day)`, `formatClock(iso)`, `formatDayHeading(day)`; `ActivityPage` client component that owns `day`, `data`, `reload()`; children take DTO slices as props.

- [ ] **Step 1: Nav, icon, dock**

`nav.ts`: add `"activity"` to `IconName`; widen `badge?: "inbox" | "activity"`; insert `{ href: "/activity", label: "Activity", shortcut: "g t", icon: "activity", badge: "activity" }` after People.
`icons.tsx`: import `Activity` from lucide and map `activity: Activity`.
`dock.tsx`: next to the inbox poll add a second effect that fetches `/api/activity/day?date=${todayLocal()}` every 60 s and on `sb:activity-changed`, storing `helperDown = !data.paused && (!data.helper.lastSeen || Date.now() - Date.parse(data.helper.lastSeen) > 120_000)`. For the item whose `badge === "activity"`, when `helperDown` render `<span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-danger" aria-hidden />` and append ", not recording" to the aria-label. Import `todayLocal` from `./activity/format`.

- [ ] **Step 2: format.ts and its test**

```ts
// src/components/activity/format.ts
export function todayLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Position of an ISO instant within a local day as a fraction 0..1. */
export function fractionOfDay(iso: string, day: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  const start = new Date(y, mo - 1, d).getTime();
  return Math.min(1, Math.max(0, (Date.parse(iso) - start) / 86_400_000));
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDayHeading(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function addDaysLocal(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return todayLocal(new Date(y, m - 1, d + n));
}
```

```ts
// src/components/activity/format.test.ts
import { describe, it, expect } from "vitest";
import { formatDuration, fractionOfDay, addDaysLocal } from "./format";

describe("activity format", () => {
  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
  });
  it("positions instants in the day", () => {
    const noon = new Date(2026, 8, 16, 12, 0, 0).toISOString();
    expect(fractionOfDay(noon, "2026-09-16")).toBeCloseTo(0.5, 5);
    expect(fractionOfDay(new Date(2026, 8, 17, 1).toISOString(), "2026-09-16")).toBe(1);
  });
  it("adds days", () => {
    expect(addDaysLocal("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysLocal("2026-09-01", -1)).toBe("2026-08-31");
  });
});
```

- [ ] **Step 3: Page and components**

`src/app/activity/page.tsx`:

```tsx
import { Suspense } from "react";
import { ActivityPage } from "@/components/activity/activity-page";

export default function Page() {
  return (
    <Suspense>
      <ActivityPage />
    </Suspense>
  );
}
```

`activity-page.tsx` (`"use client"`): reads `?date=` with `useSearchParams` (default `todayLocal()`), fetches `/api/activity/day?date=`, polls every 30 s while the day is today, holds `data: ActivityDayDTO | null` and `error: string | null`, and exposes `reload()`. Layout:

```tsx
<div className="w-full max-w-5xl mx-auto p-6 flex flex-col gap-6">
  <PageHeader
    title={formatDayHeading(day)}
    meta={data ? <span><span className="font-mono">{formatDuration(data.activeMs)}</span> active</span> : "Loading"}
    actions={
      <div className="flex items-center gap-1">
        <IconButton label="Previous day" icon={ChevronLeft} onClick={() => go(-1)} />
        <IconButton label="Next day" icon={ChevronRight} onClick={() => go(1)} disabled={day >= todayLocal()} />
        <Button variant="ghost" size="sm" onClick={() => setDay(todayLocal())}>Today</Button>
        <Chip icon={Pause} active={data?.paused ?? false} aria-pressed={data?.paused ?? false} onClick={togglePause}>
          {data?.paused ? "Paused" : "Pause"}
        </Chip>
      </div>
    }
  />
  {error && <p className="text-[13px] text-danger">{error}</p>}
  {data && <StatusStrip helper={data.helper} paused={data.paused} />}
  {data && <Timeline day={day} sessions={data.sessions} categories={data.categories} meetings={data.meetings} onRelabel={relabel} />}
  {data && <Totals data={data} />}
  {data && <Meetings meetings={data.meetings} onCapture={capture} />}
</div>
```

`setDay(d)` calls `router.replace(`/activity?date=${d}`)`; `go(n)` uses `addDaysLocal(day, n)`. `togglePause` posts `{ paused: !data.paused }` to `/api/activity/pause`, then `reload()` and dispatches `window.dispatchEvent(new Event("sb:activity-changed"))`. `relabel(sessionId, patch)` posts to `/api/activity/sessions/${id}/label` then `reload()`. `capture(eventId)` posts to `/api/activity/meetings/${id}/capture` and `router.push(`/items/${item.id}`)`.

`status-strip.tsx`: returns null when nothing needs attention. Cases in priority order:
1. `paused` → "Recording is paused." in a `bg-surface-2 border border-line` strip, no button.
2. `helper.lastSeen === null` → "The activity helper has not connected yet. Run scripts/brain.sh setup to install it."
3. last seen over 2 minutes ago → `Not recording since ${formatClock(lastSeen)}. The helper is not running.`
4. permissions missing → one line per missing grant ("Window titles need the Accessibility permission.", "Meeting names need the Calendars permission.", `Browser URLs need Automation permission for ${appName}.`) each with `Button variant="secondary" size="sm"` "Open settings" that calls `window.open(url)` where url is `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`, `...?Privacy_Calendars`, or `...?Privacy_Automation`.
Strip for cases 2 to 4: `rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] flex items-center gap-3`.

`timeline.tsx`: `div.relative.h-10.rounded-md.bg-surface-1.border.border-line.overflow-hidden` containing one absolutely positioned block per session: `left = fractionOfDay(startedAt, day) * 100 + "%"`, `width = Math.max(0.15, (fractionOfDay(endedAt, day) - fractionOfDay(startedAt, day)) * 100) + "%"`, `backgroundColor` = the category colour (`categories.find(c => c.id === categoryId)?.color ?? "#62626b"`), afk blocks use `var(--color-surface-3)`. Each block is a `button` with `aria-label` and `title` set to `${appName ?? "Away"}: ${title ?? domain ?? ""} (${formatDuration(ms)})`. Clicking a non-afk block opens a small `frost rounded-md p-2 absolute z-10` popover under the bar with the session's app and title, a row of category `Chip`s (`active` for the current one; click → `onRelabel(id, { categoryId })`), and, when `meetings.length > 0`, a `Select` of meetings with a "No meeting" option (change → `onRelabel(id, { meetingId })`). Escape or clicking elsewhere closes it. Hour ticks: labels at 0, 3, 6, 9, 12, 15, 18, 21 in `font-mono text-[10px] text-fg-faint` absolutely positioned under the bar. Legend beneath: a swatch and name per category plus "Away".

`totals.tsx`: `grid grid-cols-1 md:grid-cols-3 gap-6`; three columns each with `SectionHeading` ("By category", "By app", "By site or window") and a `List` of up to 10 `Row`s: label on the left (category name, `appName ?? appId ?? "Unknown"`, or the site label, truncated), a proportional bar (`h-1 rounded-full` coloured with the category colour or `bg-accent-dim`, width = ms / largest ms), and the duration in `font-mono text-[11px] text-fg-faint` on the right. Empty column shows "Nothing yet." in `text-fg-faint text-[13px]`.

`meetings.tsx`: `SectionHeading count={meetings.length}` "Meetings"; `EmptyState icon={CalendarDays} text="No meetings on this day."` when empty; otherwise `List` of `Row`s with: title plus `Chip as="span"` "Interview" when `interview`; `formatClock(startsAt)` to `formatClock(endsAt)` in mono; `in call ${formatDuration(actualMs)} of ${formatDuration(scheduledMs)}`; `${attendees} attendees`; and either `Button size="sm" variant="secondary" icon={FileText}` "Capture as meeting note" or `Button href={`/items/${itemId}`} size="sm" variant="ghost"` "Open note".

- [ ] **Step 4: Run tests, lint, build; look**

Run: `npm test && npm run lint && npm run build`. If a dev server is running on 3141, load `/activity` and confirm the header, an empty timeline with hour ticks, the status strip ("has not connected yet"), three empty totals columns, and "No meetings on this day."; otherwise `curl -s -o /dev/null -w "%{http_code}" http://localhost:3141/activity` returning 200 is enough.

- [ ] **Step 5: Commit**

```bash
git add src/components/nav.ts src/components/icons.tsx src/components/dock.tsx src/app/activity src/components/activity
git commit -m "feat(activity): day view with timeline, totals, meetings, and dock entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

### Task 7: Week view and rules drawer

**Files:**
- Modify: `src/components/activity/activity-page.tsx`
- Create: `src/components/activity/week.tsx`, `src/components/activity/rules-drawer.tsx`

**Interfaces:**
- Consumes: `GET /api/activity/week`, rules, exclusions, categories, pause routes; `addDaysLocal`.

- [ ] **Step 1: Week tab**

Add `view: "day" | "week"` state (query param `?view=week`). Header actions gain two `Chip`s "Day" and "Week" (`active` and `aria-pressed` by view). In week view, `weekStart = addDaysLocal(day, -((new Date(y, m - 1, d).getDay() + 6) % 7))` (Monday), fetch `/api/activity/week?start=${weekStart}`, and previous/next move by 7 days. `week.tsx` renders `grid grid-cols-7 gap-2`: per day a `button` column containing a `flex flex-col-reverse h-40 rounded-md bg-surface-1 border border-line overflow-hidden` bar with one segment per category (height = `ms / maxDayMs * 100%`, background the category colour), the weekday letter beneath in `text-[12px] text-fg-muted`, and the total in `font-mono text-[11px] text-fg-faint`; clicking a column sets `day` and `view = "day"`. Title in the header becomes `Week of ${formatDayHeading(weekStart)}` and the meta shows the week's total active time.

- [ ] **Step 2: Rules drawer**

Header gains `Button variant="ghost" size="sm" icon={SlidersHorizontal}` "Rules" that opens `rules-drawer.tsx`: a fixed right panel (`fixed inset-y-0 right-0 w-[420px] frost p-5 overflow-y-auto z-50`) with a backdrop `button` (`fixed inset-0 bg-black/40`, `aria-label="Close"`); Escape closes. The drawer fetches `/api/activity/rules`, `/exclusions`, and `/categories` on open. Sections, each with a `SectionHeading`:
- **Rules**: `List` of `Row`s: `Chip as="span"` with the kind in sentence case ("App", "Domain", "Title contains"), the pattern in `font-mono text-[12px]`, a `Select size="sm"` of categories (change → PATCH `/rules/[id]`), `IconButton`s "Move up" / "Move down" (`ArrowUp`/`ArrowDown`; POST `/rules/reorder` with the new id order), and "Delete rule" (`Trash2`; DELETE). Add form beneath: `Select size="sm"` kind, `Input size="sm"` pattern (placeholder "Bundle id, domain, or words in the title"), `Select size="sm"` category, `Button variant="primary" size="sm"` "Add rule".
- **Never record**: `List` of exclusions (`Chip as="span"` kind, mono pattern, "Remove" `IconButton`) and an add form (kind `Select`, pattern `Input`, "Add exclusion").
- **Categories**: a `Row` per category with `<input type="color">` (styled `w-6 h-6 rounded-sm border border-line bg-transparent`) and a name `Input size="sm"`; blur → PATCH `/categories/[id]`.
- **Retention**: `Input size="sm" type="number" min={1} max={3650}` days; blur → POST `/pause` with `{ retentionDays }`; helper text "Sessions older than this are deleted nightly." in `text-[12px] text-fg-faint`.
After any rule, exclusion, or category change the drawer calls the page's `reload()`.

- [ ] **Step 3: Run tests, lint, build; look; commit**

Run: `npm test && npm run lint && npm run build`. If a dev server is available, open the drawer, add a rule, move it up, and confirm the day view reloads.

```bash
git add src/components/activity
git commit -m "feat(activity): week view and rules drawer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j"
```

---

## Self-review

- Spec coverage: helper (2.1) → Task 5; data model and seeds (2.2) → Task 1 (plus `closed` and `titleChangedAt` columns needed by folding; `endedAt` is non-null and `closed` carries the open state, an implementation detail the spec allows); folding, gap, debounce, rules, meetings on open, server-side exclusions, prune, recategorise (2.3) → Tasks 2 and 3 plus the backup hook in Task 4; API (2.4) → Task 4; UI (2.5) → Tasks 6 and 7; errors (2.6) → the status strip in Task 6 and the gap rule in Task 2; testing (2.7) → each task; scripts and README (4) → Task 5. Journal integration waits for the journal slice, as the spec says.
- Placeholders: none; every code step carries its code.
- Type consistency: `Heartbeat`, `Sample`, `ActivityDay`, `ActivityMeeting`, DTO names, `findMeetingFor`, `labelMeetings`, `findCapturedMeetingItem`, `captureMeeting`, `getHelperState`, `recordHelperSeen`, `isPaused`, `setPaused`, `retentionDays`, `setRetentionDays`, `AFK_SECONDS`, `EXCLUDED_APP_ID`, `addDays` (domain) versus `addDaysLocal` (client) are used with the same names across tasks.
