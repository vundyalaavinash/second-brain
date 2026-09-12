import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { saveFile } from "@/lib/files";
import { createItem, getItem, getItemChunks } from "@/domain/items";
import { enqueueJob, listJobs } from "@/jobs/queue";
import { createOcrImageHandler } from "./ocr-image";

describe("ocr_image handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("stores recognized text, chunks it, and queues embedding", async () => {
    const saved = saveFile(Buffer.from("fake png"), "shot.png");
    const item = createItem(t.db, { type: "file", title: "shot.png", filePath: saved.relativePath, mimeType: "image/png" });
    const job = enqueueJob(t.db, "ocr_image", { itemId: item.id }, item.id);
    const seen: string[] = [];
    const ocr = async (p: string) => {
      seen.push(p);
      return "Whiteboard: ship v1 by Friday";
    };
    await createOcrImageHandler({ db: t.db, ocr })(job);
    expect(seen).toEqual([saved.absolutePath]);
    expect(getItem(t.db, item.id)?.extractedText).toBe("Whiteboard: ship v1 by Friday");
    expect(getItemChunks(t.db, item.id)).toHaveLength(1);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["ocr_image", "embed"]);
  });
});
