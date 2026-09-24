import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tasks } from "@/db/schema";
import { getDay, getHelperState, localDay, topApps } from "@/domain/activity";
import { listBlocks } from "@/domain/blocks";
import { listContainers } from "@/domain/containers";
import { countInbox, listItems, parseMeta } from "@/domain/items";
import { containerProgress } from "@/domain/tasks";
import { daysBetween } from "./deadline";
import { plannerDay } from "./planner";
import type { HomeDTO, HomeItemDTO, ProjectCardDTO, RecentItemDTO } from "./dto";

/** How many project cards the right column holds. */
const MAX_PROJECTS = 6;
/** A deadline this close keeps a project in motion even with nothing open left on it. */
const IN_MOTION_DAYS = 14;
/** How many items Recent lists. */
const RECENT_LIMIT = 5;
/** How many apps or sites the activity line names. */
const TOP_ACTIVITY = 3;
/** How many timed things stand under the current one. */
const NEXT_LIMIT = 2;

const pad = (n: number) => String(n).padStart(2, "0");

/** A session's end in the same local wall-clock spelling its start uses. */
function sessionEnd(startsAt: string, minutes: number): string {
  const at = new Date(Date.parse(startsAt) + minutes * 60_000);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/**
 * Every timed thing on the day, in start order: meetings a person has not declined, and the
 * sessions of tasks still open. An all-day block holds no hour, so it names no "now", and a
 * session of a task already ticked off or dropped is not work still to do.
 */
function timedItems(db: DB, day: HomeDTO["day"], date: string): HomeItemDTO[] {
  const meetings: HomeItemDTO[] = day.meetings
    .filter((m) => !m.allDay && m.status !== "declined")
    .map((m) => ({
      kind: "meeting" as const,
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      meetingId: m.id,
      ...(m.joinUrl ? { joinUrl: m.joinUrl } : {}),
    }));
  const blocks = listBlocks(db, { date });
  // One query for every session's task rather than one per session.
  const open = new Map(
    blocks.length === 0
      ? []
      : db
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, [...new Set(blocks.map((b) => b.taskId))]))
          .all()
          .filter((t) => t.status === "open")
          .map((t) => [t.id, t.title] as const),
  );
  const sessions: HomeItemDTO[] = blocks
    .filter((b) => open.has(b.taskId))
    .map((b) => ({
      kind: "session" as const,
      title: open.get(b.taskId)!,
      startsAt: b.startsAt,
      endsAt: sessionEnd(b.startsAt, b.minutes),
      taskId: b.taskId,
      blockId: b.id,
    }));
  return [...meetings, ...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * What is happening now and what stands under it. A meeting in progress wins over a session in
 * progress — the meeting is where the person has to be — and `next` is the two soonest things
 * still to start, so whatever `now` holds can never appear under it as well.
 */
function nowAndNext(items: HomeItemDTO[], at: number): { now: HomeItemDTO | null; next: HomeItemDTO[] } {
  const running = items.filter((i) => Date.parse(i.startsAt) <= at && at < Date.parse(i.endsAt));
  // Of two things running at once the nearer end is the more pressing: a standup inside an
  // all-hands is what the next few minutes are actually about.
  const soonestEnd = (list: HomeItemDTO[]) => [...list].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0];
  const now = soonestEnd(running.filter((i) => i.kind === "meeting")) ?? soonestEnd(running) ?? null;
  return { now, next: items.filter((i) => Date.parse(i.startsAt) > at).slice(0, NEXT_LIMIT) };
}

/** Nearest deadline first, the undated behind them, and the most recently touched first within a tie. */
function byDeadlineThenUpdated(a: ProjectCardDTO, b: ProjectCardDTO): number {
  if (a.deadline !== b.deadline) {
    if (a.deadline === null) return 1;
    if (b.deadline === null) return -1;
    return a.deadline.localeCompare(b.deadline);
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * The active projects in motion, at most six. "In motion" is something open to do on them —
 * or, with nothing open, a deadline close enough that having nothing open is itself the news.
 * An active project with neither is not moving, so it stays off a page about today.
 */
function projectCards(db: DB, today: string): ProjectCardDTO[] {
  const active = listContainers(db, { kind: "project", status: "active" });
  // The open count is what decides whether a project is in motion at all, so it is read for
  // every active one — still two grouped queries, not a pair per project.
  const progress = containerProgress(db, active.map((c) => c.id));
  return active
    .map((c) => {
      const p = progress.get(c.id);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        open: p?.open ?? 0,
        done: p?.done ?? 0,
        nextTask: p?.nextTask ? { id: p.nextTask.id, title: p.nextTask.title } : null,
        deadline: c.deadline,
        updatedAt: c.updatedAt,
      } satisfies ProjectCardDTO;
    })
    // A deadline already past counts as near: the day it slipped is exactly when to see it.
    .filter((c) => c.open > 0 || (c.deadline !== null && daysBetween(today, c.deadline) <= IN_MOTION_DAYS))
    .sort(byDeadlineThenUpdated)
    .slice(0, MAX_PROJECTS);
}

/** The last five items touched; a meeting item carries what its chip says about it. */
function recentItems(db: DB): RecentItemDTO[] {
  return listItems(db, { limit: RECENT_LIMIT, orderBy: "updated" }).map((item) => {
    const row: RecentItemDTO = { id: item.id, type: item.type, title: item.title, updatedAt: item.updatedAt, status: item.status };
    if (item.type !== "meeting") return row;
    const meta = parseMeta(item);
    return { ...row, meeting: { hasTranscript: !!meta.transcript, hasSummary: !!meta.summary } };
  });
}

/**
 * Active time and the three things that took most of it; null until the helper has ever
 * reported. One line per app, never an app and its own pages as two, so the three add up to
 * something. An app whose time is mostly on the web is named by the site it spent it on.
 */
function activityToday(db: DB, date: string): HomeDTO["activity"] {
  if (getHelperState(db).lastSeen === null) return null;
  const report = getDay(db, date);
  const ms = (s: { startedAt: string; endedAt: string }) => Date.parse(s.endedAt) - Date.parse(s.startedAt);
  const awake = report.sessions.filter((s) => !s.afk);
  const top = topApps(
    awake.map((s) => ({ appId: s.appId, appName: s.appName, domain: s.domain, ms: ms(s) })),
    TOP_ACTIVITY,
  );
  return { activeMs: report.activeMs, top };
}

/**
 * Where the day stands, in one payload. The Planner's own day is reused whole — Home draws the
 * same plan rows and the same capacity line — and the counts are read back off it rather than
 * asked for again, so the figures and the rows under them can never disagree.
 */
export function homePayload(db: DB, now: Date): HomeDTO {
  const date = localDay(now.toISOString());
  const day = plannerDay(db, date);
  const { now: current, next } = nowAndNext(timedItems(db, day, date), now.getTime());
  return {
    date,
    today: date,
    // The moment the page is a picture of; Recent dates its rows against it rather than against
    // whatever the browser's clock says as it hydrates.
    generatedAt: now.toISOString(),
    day,
    counts: {
      planned: day.plan.filter((t) => t.status === "open").length,
      // The same meetings the capacity line measures: a declined one takes none of the day.
      meetings: day.meetings.filter((m) => !m.allDay && m.status !== "declined").length,
      // The dock's badge count, called rather than counted again.
      inbox: countInbox(db),
    },
    now: current,
    next,
    projects: projectCards(db, date),
    recent: recentItems(db),
    activity: activityToday(db, date),
  };
}
