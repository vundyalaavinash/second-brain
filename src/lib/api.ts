import { NextResponse } from "next/server";
import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
import { getItemTags, parseMeta } from "@/domain/items";
import { CaptureError } from "@/domain/items/capture";
import type { ItemDTO } from "./dto";

export function serializeItem(db: DB, item: Item): ItemDTO {
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
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof CaptureError) {
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
