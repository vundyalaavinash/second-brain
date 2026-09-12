import type { DB } from "@/db/client";
import type { Item } from "@/db/schema";
import { enqueueJob } from "@/jobs/queue";
import { saveFile, kindForMime } from "@/lib/files";
import { deriveTitle } from "@/lib/text";
import { createItem, getItem, rechunkItem, setItemTags, updateItem } from "./index";

export { deriveTitle, isProbablyUrl } from "@/lib/text";

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

function queueEmbedding(db: DB, itemId: number): void {
  rechunkItem(db, itemId);
  enqueueJob(db, "embed", { itemId }, itemId);
}

export function captureNote(db: DB, input: { title?: string; body: string; tags?: string[] }): Item {
  const title = input.title?.trim() || deriveTitle(input.body);
  const item = createItem(db, { type: "note", title, body: input.body });
  if (input.tags) setItemTags(db, item.id, input.tags);
  queueEmbedding(db, item.id);
  return getItem(db, item.id)!;
}

export function captureLink(db: DB, input: { url: string; title?: string; tags?: string[] }): Item {
  const raw = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CaptureError(`Not a valid url: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CaptureError("Only http and https links can be captured");
  }
  const item = createItem(db, { type: "link", title: input.title?.trim() || raw, sourceUrl: raw });
  if (input.tags) setItemTags(db, item.id, input.tags);
  enqueueJob(db, "fetch_link", { itemId: item.id }, item.id);
  return getItem(db, item.id)!;
}

export function captureFile(db: DB, input: { bytes: Buffer; name: string; mime: string; tags?: string[] }): Item {
  const kind = kindForMime(input.mime, input.name);
  if (kind === "audio") {
    throw new CaptureError("Audio files are captured as meetings, which arrive with the meetings slice", 415);
  }
  const saved = saveFile(input.bytes, input.name);
  const item = createItem(db, {
    type: "file",
    title: input.name,
    filePath: saved.relativePath,
    mimeType: input.mime,
    meta: { kind, size: input.bytes.length },
  });
  if (input.tags) setItemTags(db, item.id, input.tags);
  if (kind === "pdf") enqueueJob(db, "extract_pdf", { itemId: item.id }, item.id);
  else if (kind === "image") enqueueJob(db, "ocr_image", { itemId: item.id }, item.id);
  else queueEmbedding(db, item.id);
  return getItem(db, item.id)!;
}

export function updateItemContent(db: DB, id: number, patch: { title?: string; body?: string; tags?: string[] }): Item {
  if (!getItem(db, id)) throw new CaptureError(`Item ${id} not found`, 404);
  updateItem(db, id, { title: patch.title, body: patch.body });
  if (patch.tags) setItemTags(db, id, patch.tags);
  queueEmbedding(db, id);
  return getItem(db, id)!;
}
