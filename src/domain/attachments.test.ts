import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, deleteItem } from "@/domain/items";
import { saveAttachment, getAttachment, attachmentPath, listAttachments, AttachmentError } from "./attachments";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("attachments", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("saves, serves, lists, and removes with the item", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const a = saveAttachment(t.db, { itemId: item.id, filename: "shot.png", mime: "image/png", bytes: PNG });
    expect(a.itemId).toBe(item.id);
    expect(fs.readFileSync(attachmentPath(a))).toEqual(PNG);
    expect(attachmentPath(a)).toContain(`/attachments/${item.id}/`);
    expect(getAttachment(t.db, a.id)?.filename).toBe("shot.png");
    expect(listAttachments(t.db, item.id)).toHaveLength(1);
    deleteItem(t.db, item.id);
    expect(getAttachment(t.db, a.id)).toBeUndefined();
    expect(fs.existsSync(attachmentPath(a))).toBe(false);
  });

  it("rejects bad mimes, oversize files, and unknown items", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    expect(() => saveAttachment(t.db, { itemId: item.id, filename: "x.svg", mime: "image/svg+xml", bytes: PNG })).toThrow(AttachmentError);
    expect(() => saveAttachment(t.db, { itemId: item.id, filename: "x.png", mime: "image/png", bytes: Buffer.alloc(20 * 1024 * 1024 + 1) })).toThrow(/20 MB/);
    expect(() => saveAttachment(t.db, { itemId: 999, filename: "x.png", mime: "image/png", bytes: PNG })).toThrow(/not found/);
  });

  it("rejects content that does not match its declared mime type", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    expect(() => saveAttachment(t.db, { itemId: item.id, filename: "x.jpg", mime: "image/jpeg", bytes: PNG })).toThrow(/does not match its type/);
    try {
      saveAttachment(t.db, { itemId: item.id, filename: "x.jpg", mime: "image/jpeg", bytes: PNG });
    } catch (e) {
      expect(e).toBeInstanceOf(AttachmentError);
      expect((e as AttachmentError).status).toBe(415);
    }
  });

  it("sanitises file names", () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const a = saveAttachment(t.db, { itemId: item.id, filename: "../../evil name?.png", mime: "image/png", bytes: PNG });
    expect(attachmentPath(a)).not.toContain("..");
    expect(attachmentPath(a)).toMatch(/evil_name_\.png$/);
  });
});
