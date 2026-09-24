import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type CalendarEvent, type Item, type Container, type Person, type Task, type TaskBlock } from "@/db/schema";
import { domainOf } from "@/lib/text";
import { getItemTags, parseMeta } from "@/domain/items";
import { CaptureError, DuplicateError } from "@/domain/items/capture";
import { getContainer, countContainerItems, ContainerError } from "@/domain/containers";
import { getItemPeople, PersonError } from "@/domain/people";
import { ActivityError } from "@/domain/activity/rules";
import { MeetingError } from "@/domain/meetings/errors";
import { AttachmentError } from "@/domain/attachments";
import { projectProgress, containerProgress, TaskError } from "@/domain/tasks";
import { blocksByTask, BlockError } from "@/domain/blocks";
import { GoalError, type GoalWithMeasure } from "@/domain/goals";
import { addDays, localDay } from "@/domain/activity";
import { isInterview, parseAttendeeNames } from "@/domain/activity/calendar";
import type { ActivityMeetingDTO, BlockDTO, ItemDTO, ContainerDTO, PersonDTO, TaskDTO, PlanTaskDTO, PinnedLinkDTO, GoalDTO } from "./dto";

export function serializeItem(db: DB, item: Item): ItemDTO {
  const container = item.containerId ? getContainer(db, item.containerId) : undefined;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    status: item.status,
    error: item.error,
    sourceUrl: item.sourceUrl,
    filePath: item.filePath,
    mimeType: item.mimeType,
    extractedText: item.extractedText,
    meta: parseMeta(item),
    tags: getItemTags(db, item.id),
    journalDate: item.journalDate,
    reviewWeek: item.reviewWeek,
    containerId: item.containerId,
    container: container ? { id: container.id, name: container.name, slug: container.slug, kind: container.kind } : null,
    archivedAt: item.archivedAt,
    pinned: item.pinned === 1,
    people: getItemPeople(db, item.id).map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toPinnedLink(item: Item): PinnedLinkDTO {
  const url = item.sourceUrl ?? "";
  return { id: item.id, title: item.title, url, domain: domainOf(url) };
}

/**
 * The newest three pinned, non-archived link items per container, in one query for all ids
 * instead of one per container. Ordered by createdAt desc, matching the Links section's own
 * pinned-then-newest order (LinksSection's `bySort` in links-section.tsx), so a project's card
 * and its own page agree on which links show.
 */
function pinnedLinksByContainer(db: DB, ids: number[]): Map<number, PinnedLinkDTO[]> {
  const out = new Map<number, PinnedLinkDTO[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = db
    .select()
    .from(items)
    .where(and(inArray(items.containerId, ids), eq(items.type, "link"), eq(items.pinned, 1), isNull(items.archivedAt)))
    .orderBy(desc(items.createdAt), desc(items.id))
    .all();
  for (const row of rows) {
    const list = out.get(row.containerId!);
    if (list && list.length < 3) list.push(toPinnedLink(row));
  }
  return out;
}

export function serializeContainer(db: DB, c: Container): ContainerDTO {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    description: c.description,
    status: c.status,
    goal: c.goal,
    deadline: c.deadline,
    standard: c.standard,
    category: c.category,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
    itemCount: countContainerItems(db, c.id),
    totalItemCount: countContainerItems(db, c.id, true),
    progress: projectProgress(db, c.id),
    pinnedLinks: pinnedLinksByContainer(db, [c.id]).get(c.id)!,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Serializes many containers with progress and pinned links computed in grouped queries instead of one per row. */
export function serializeContainers(db: DB, list: Container[]): ContainerDTO[] {
  const ids = list.map((c) => c.id);
  const progress = containerProgress(db, ids);
  const pinnedLinks = pinnedLinksByContainer(db, ids);
  return list.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    description: c.description,
    status: c.status,
    goal: c.goal,
    deadline: c.deadline,
    standard: c.standard,
    category: c.category,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
    itemCount: countContainerItems(db, c.id),
    totalItemCount: countContainerItems(db, c.id, true),
    progress: progress.get(c.id)!,
    pinnedLinks: pinnedLinks.get(c.id)!,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

export function serializeBlock(b: TaskBlock): BlockDTO {
  return { id: b.id, taskId: b.taskId, startsAt: b.startsAt, minutes: b.minutes };
}

/** A task and its sessions. Sessions are passed in rather than read here, so a list pays for one
 * query instead of one per row. */
export function serializeTask(t: Task, blocks: TaskBlock[] = []): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    containerId: t.containerId,
    sourceItemId: t.sourceItemId,
    estimateMinutes: t.estimateMinutes,
    sessionMinutes: t.sessionMinutes,
    blocks: blocks.map(serializeBlock),
    completedAt: t.completedAt,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** The plan entry's order wins over the task's own: on a plan, position means the day's order. */
export function serializePlanTask(t: Task & { planId: number; sortOrder: number }, blocks: TaskBlock[] = []): PlanTaskDTO {
  return { ...serializeTask(t, blocks), sortOrder: t.sortOrder, planId: t.planId };
}

/** How many days either side of today a task list carries sessions for: last week, because a
 * session missed is still worth saying, and two months ahead, which is further than any screen
 * plans. Past that a payload would grow with a task's whole history for nothing. */
const WINDOW_BEFORE = 7;
const WINDOW_AFTER = 60;

/** The window a list of tasks carries its sessions in; `to` is exclusive, both are dates. */
export function taskBlockWindow(today: string = localDay(new Date().toISOString())): { from: string; to: string } {
  return { from: addDays(today, -WINDOW_BEFORE), to: addDays(today, WINDOW_AFTER) };
}

/** A list of tasks with their sessions, in one query for the lot. The window bounds what each
 * row carries: without one a task placed every day for a year would serialize all of it. */
export function serializeTasks(db: DB, list: Task[], window: { from: string; to: string } = taskBlockWindow()): TaskDTO[] {
  const byTask = blocksByTask(db, list.map((t) => t.id), window);
  return list.map((t) => serializeTask(t, byTask.get(t.id) ?? []));
}

/** A day's plan with its sessions, in one query for the lot. */
export function serializePlanTasks(
  db: DB,
  list: (Task & { planId: number; sortOrder: number })[],
  window: { from: string; to: string } = taskBlockWindow(),
): PlanTaskDTO[] {
  const byTask = blocksByTask(db, list.map((t) => t.id), window);
  return list.map((t) => serializePlanTask(t, byTask.get(t.id) ?? []));
}

/**
 * A calendar row as the Planner reads it. `actualMs` is 0: measuring how long a meeting was
 * actually attended means walking that day's sessions, which `getDay` does for the Activity
 * page; the Planner shows scheduled time and never asks for the measured figure.
 */
export function serializeMeeting(ev: CalendarEvent): ActivityMeetingDTO {
  return {
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    attendees: ev.attendees,
    hasCallLink: ev.hasCallLink === 1,
    interview: isInterview(ev.title),
    scheduledMs: Date.parse(ev.endsAt) - Date.parse(ev.startsAt),
    actualMs: 0,
    itemId: ev.itemId,
    organizer: ev.organizer,
    attendeeNames: parseAttendeeNames(ev.attendeeNames),
    location: ev.location,
    joinUrl: ev.joinUrl,
    allDay: ev.allDay === 1,
    status: ev.status,
    calendarTitle: ev.calendarTitle,
    noRecord: ev.noRecord === 1,
  };
}

export function serializeGoal(g: GoalWithMeasure): GoalDTO {
  return {
    id: g.id,
    title: g.title,
    outcome: g.outcome,
    horizon: g.horizon,
    targetDate: g.targetDate,
    status: g.status,
    notes: g.notes,
    sortOrder: g.sortOrder,
    closedAt: g.closedAt,
    measure: g.measure,
    containers: g.containers,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

export function serializePerson(p: Person & { itemCount?: number }, itemCount?: number): PersonDTO {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    profile: p.profile,
    itemCount: itemCount ?? p.itemCount ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Whether the request came from a page that is not this app. Routes that run a local command
 * or drive the recording helper gate on it, so a page on any other site cannot reach them
 * through the browser: a POST with no body takes no preflight, so a cross-origin `no-cors`
 * fetch or form post would otherwise land. A request with no `Origin` header is not a
 * cross-site form post and is let through.
 */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const { port } = new URL(req.url);
  const suffix = port ? `:${port}` : "";
  return origin !== `http://127.0.0.1${suffix}` && origin !== `http://localhost${suffix}`;
}

/** The one answer every origin-gated route gives, so they are indistinguishable from outside. */
export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof DuplicateError) {
    return NextResponse.json({ error: err.message, existingId: err.existingId }, { status: err.status });
  }
  // A body that fails schema validation is a client mistake, not a server one: it reads as 400
  // here so a route that parses straight through zod never needs its own catch for it.
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (
    err instanceof CaptureError ||
    err instanceof ContainerError ||
    err instanceof PersonError ||
    err instanceof ActivityError ||
    err instanceof MeetingError ||
    err instanceof AttachmentError ||
    err instanceof TaskError ||
    err instanceof BlockError ||
    err instanceof GoalError
  ) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse a positive integer route param. Throws CaptureError(400) otherwise. */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new CaptureError(`Invalid id: ${raw}`, 400);
  return id;
}

/** `container=<id>` → id, `container=inbox` → null, absent → undefined. Throws CaptureError(400) on garbage. */
export function parseContainerParam(raw: string | null): number | null | undefined {
  if (raw === null || raw === "") return undefined;
  if (raw === "inbox") return null;
  return parseId(raw);
}
