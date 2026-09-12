import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { MINIMAL_PDF } from "@/test/fixtures";
import { saveFile } from "@/lib/files";
import { createItem, getItem, getItemChunks, parseMeta } from "@/domain/items";
import { enqueueJob, listJobs } from "@/jobs/queue";
import { createExtractPdfHandler } from "./extract-pdf";

describe("extract_pdf handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("extracts text, records page count, chunks, and queues embedding", async () => {
    const saved = saveFile(MINIMAL_PDF, "hello.pdf");
    const item = createItem(t.db, { type: "file", title: "hello.pdf", filePath: saved.relativePath, mimeType: "application/pdf" });
    const job = enqueueJob(t.db, "extract_pdf", { itemId: item.id }, item.id);
    await createExtractPdfHandler({ db: t.db })(job);
    const after = getItem(t.db, item.id)!;
    expect(after.extractedText).toBe("Hello Brain");
    expect(parseMeta<{ page_count: number }>(after).page_count).toBe(1);
    expect(getItemChunks(t.db, item.id)).toHaveLength(1);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["extract_pdf", "embed"]);
  });

  it("throws when the item has no file", async () => {
    const item = createItem(t.db, { type: "file", title: "x" });
    const job = enqueueJob(t.db, "extract_pdf", { itemId: item.id }, item.id);
    await expect(createExtractPdfHandler({ db: t.db })(job)).rejects.toThrow(/no file/i);
  });
});
