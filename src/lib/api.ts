import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type Item, type Container, type Person, type Task } from "@/db/schema";
import { getItemTags, parseMeta } from "@/domain/items";
import { CaptureError, DuplicateError } from "@/domain/items/capture";
import { getContainer, countContainerItems, ContainerError } from "@/domain/containers";
import { getItemPeople, PersonError } from "@/domain/people";
import { ActivityError } from "@/domain/activity/rules";
import { AttachmentError } from "@/domain/attachments";
import { projectProgress, containerProgress, TaskError } from "@/domain/tasks";
import type { ItemDTO, ContainerDTO, PersonDTO, TaskDTO, PinnedLinkDTO } from "./dto";

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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toPinnedLink(item: Item): PinnedLinkDTO {
  const url = item.sourceUrl ?? "";
  return { id: item.id, title: item.title, url, domain: domainOf(url) };
}

/**
 * The newest three pinned, non-archived link items per container, in one query for all ids
 * instead of one per container.
 */
function pinnedLinksByContainer(db: DB, ids: number[]): Map<number, PinnedLinkDTO[]> {
  const out = new Map<number, PinnedLinkDTO[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = db
    .select()
    .from(items)
    .where(and(inArray(items.containerId, ids), eq(items.type, "link"), eq(items.pinned, 1), isNull(items.archivedAt)))
    .orderBy(desc(items.updatedAt))
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

export function serializeTask(t: Task): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    containerId: t.containerId,
    sourceItemId: t.sourceItemId,
    completedAt: t.completedAt,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
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

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof DuplicateError) {
    return NextResponse.json({ error: err.message, existingId: err.existingId }, { status: err.status });
  }
  if (
    err instanceof CaptureError ||
    err instanceof ContainerError ||
    err instanceof PersonError ||
    err instanceof ActivityError ||
    err instanceof AttachmentError ||
    err instanceof TaskError
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
