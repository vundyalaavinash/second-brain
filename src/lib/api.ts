import { NextResponse } from "next/server";
import type { DB } from "@/db/client";
import type { Item, Container, Person } from "@/db/schema";
import { getItemTags, parseMeta } from "@/domain/items";
import { CaptureError, DuplicateError } from "@/domain/items/capture";
import { getContainer, countContainerItems, ContainerError } from "@/domain/containers";
import { getItemPeople, PersonError } from "@/domain/people";
import type { ItemDTO, ContainerDTO, PersonDTO } from "./dto";

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
    people: getItemPeople(db, item.id).map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
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
    nextSteps: c.nextSteps,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
    itemCount: countContainerItems(db, c.id),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
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
  if (err instanceof CaptureError || err instanceof ContainerError || err instanceof PersonError) {
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
