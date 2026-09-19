import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { attachments, items, type Attachment } from "@/db/schema";
import { attachmentsDir } from "@/lib/paths";
import { nowIso } from "@/lib/time";

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-]+/g, "_").slice(-120);
  return base && base !== "." && base !== ".." ? base : "image";
}

export function attachmentPath(a: Attachment): string {
  return path.join(attachmentsDir(), String(a.itemId), `${a.id}-${a.filename}`);
}

export function saveAttachment(db: DB, input: { itemId: number; filename: string; mime: string; bytes: Buffer }): Attachment {
  if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(input.mime)) throw new AttachmentError("Only PNG, JPEG, GIF, and WebP images can be attached", 415);
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("Images must be 20 MB or smaller", 413);
  if (!db.select({ id: items.id }).from(items).where(eq(items.id, input.itemId)).get()) throw new AttachmentError("Item not found", 404);
  const row = db
    .insert(attachments)
    .values({ itemId: input.itemId, filename: safeName(input.filename), mime: input.mime, bytes: input.bytes.length, createdAt: nowIso() })
    .returning()
    .get();
  if (!row) throw new Error("Insert returned no row");
  const file = attachmentPath(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.bytes);
  return row;
}

export function getAttachment(db: DB, id: number): Attachment | undefined {
  return db.select().from(attachments).where(eq(attachments.id, id)).get();
}

export function listAttachments(db: DB, itemId: number): Attachment[] {
  return db.select().from(attachments).where(eq(attachments.itemId, itemId)).orderBy(asc(attachments.id)).all();
}

/** Removes the item's attachment directory. Rows are removed by the foreign-key cascade when the item is deleted. */
export function deleteItemAttachments(itemId: number): void {
  fs.rmSync(path.join(attachmentsDir(), String(itemId)), { recursive: true, force: true });
}
