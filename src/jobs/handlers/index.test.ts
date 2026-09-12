import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { MINIMAL_PDF } from "@/test/fixtures";
import { captureNote, captureLink, captureFile } from "@/domain/items/capture";
import { getItem } from "@/domain/items";
import { ARTICLE_HTML } from "@/test/fixtures";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import { countChunkVectors } from "@/domain/search/vectors";
import { JobWorker } from "@/jobs/worker";
import { createJobHandlers } from "./index";

describe("createJobHandlers", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("drives every capture type to ready through the worker", async () => {
    const worker = new JobWorker(
      t.db,
      createJobHandlers({
        db: t.db,
        embed: createFakeEmbedProvider(),
        fetchImpl: async () => new Response(ARTICLE_HTML, { status: 200 }),
        ocr: async () => "ocr text",
      }),
    );
    const note = captureNote(t.db, { body: "a note" });
    const link = captureLink(t.db, { url: "https://example.test/p" });
    const pdf = captureFile(t.db, { bytes: MINIMAL_PDF, name: "h.pdf", mime: "application/pdf" });
    const img = captureFile(t.db, { bytes: Buffer.from("x"), name: "i.png", mime: "image/png" });

    while (await worker.runOnce()) {
      /* drain */
    }

    for (const item of [note, link, pdf, img]) {
      expect(getItem(t.db, item.id)?.status).toBe("ready");
    }
    expect(getItem(t.db, link.id)?.title).toMatch(/Test Article/);
    expect(getItem(t.db, pdf.id)?.extractedText).toBe("Hello Brain");
    expect(getItem(t.db, img.id)?.extractedText).toBe("ocr text");
    expect(countChunkVectors(t.db)).toBeGreaterThanOrEqual(4);
  });
});
