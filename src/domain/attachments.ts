import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { attachments, items, type Attachment } from "@/db/schema";
import { attachmentsDir } from "@/lib/paths";
import { nowIso } from "@/lib/time";
import { ALLOWED_IMAGE_MIMES } from "@/lib/image-mimes";

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

/** Magic-byte checks per declared MIME type, so a mislabelled upload (e.g. a renamed
 * script served as `image/png`) is rejected instead of trusted on the client's say-so. */
const MAGIC_BYTES: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.length >= 4 && b.subarray(0, 4).toString("ascii") === "GIF8",
  "image/webp": (b) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

function matchesDeclaredMime(mime: string, bytes: Buffer): boolean {
  return MAGIC_BYTES[mime]?.(bytes) ?? false;
}

export function attachmentPath(a: Attachment): string {
  return path.join(attachmentsDir(), String(a.itemId), `${a.id}-${a.filename}`);
}

export function saveAttachment(db: DB, input: { itemId: number; filename: string; mime: string; bytes: Buffer }): Attachment {
  if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(input.mime)) throw new AttachmentError("Only PNG, JPEG, GIF, and WebP images can be attached", 415);
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("Images must be 20 MB or smaller", 413);
  if (!matchesDeclaredMime(input.mime, input.bytes)) throw new AttachmentError("File content does not match its type", 415);
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
