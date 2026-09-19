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

/** No matching rule falls into the catch-all "Other" category rather than staying uncategorised. */
function otherCategoryId(db: DB): number | null {
  return listCategories(db).find((c) => c.name === "Other")?.id ?? null;
}

function open(db: DB, at: string, sample: Sample | null): ActivitySession {
  const domain = sample ? domainOf(sample.url) : null;
  const categoryId = sample ? (evaluateRules(listRules(db), sample) ?? otherCategoryId(db)) : null;
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
    if (latest && !latest.closed) {
      const gapped = t - Date.parse(latest.endedAt) > GAP_MS;
      close(db, latest, gapped ? latest.endedAt : hb.at);
    }
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
  if (patch.categoryId !== undefined) {
    if (patch.categoryId !== null && !listCategories(db).some((c) => c.id === patch.categoryId)) {
      throw new ActivityError("Category not found", 404);
    }
    set.categoryId = patch.categoryId;
    set.manual = patch.categoryId !== null ? 1 : 0;
  }
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

/**
 * Re-evaluate rules for non-afk, non-manually-labelled sessions started in the last `days` days.
 * Returns the number of rows changed.
 */
export function recategorise(db: DB, days: number, now: Date = new Date()): number {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rules = listRules(db);
  const otherId = otherCategoryId(db);
  const rows = db
    .select()
    .from(activitySessions)
    .where(eq(activitySessions.afk, 0))
    .all()
    .filter((s) => s.startedAt >= since && s.manual !== 1);
  let changed = 0;
  db.transaction((tx) => {
    for (const s of rows) {
      const categoryId = evaluateRules(rules, { appId: s.appId, appName: s.appName, title: s.title, url: s.url }) ?? otherId;
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
