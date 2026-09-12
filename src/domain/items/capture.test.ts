import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { makeTestDb, type TestDb } from "@/test/db";
import { MINIMAL_PDF } from "@/test/fixtures";
import { listJobs } from "@/jobs/queue";
import { getItemChunks, getItemTags } from "./index";
import { absoluteFilePath } from "@/lib/files";
import { captureNote, captureLink, captureFile, updateItemContent, deriveTitle, isProbablyUrl, CaptureError } from "./capture";

describe("capture", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("derives titles from the first line", () => {
    expect(deriveTitle("# Meeting notes\n\nstuff")).toBe("Meeting notes");
    expect(deriveTitle("\n\n  plain first line here\nmore")).toBe("plain first line here");
    expect(deriveTitle("x".repeat(100))).toHaveLength(80);
    expect(deriveTitle("   ")).toBe("Untitled note");
  });

  it("detects a lone url", () => {
    expect(isProbablyUrl("https://example.com/a?b=1")).toBe(true);
    expect(isProbablyUrl("  http://x.io  ")).toBe(true);
    expect(isProbablyUrl("see https://example.com")).toBe(false);
    expect(isProbablyUrl("https://a.com\nhttps://b.com")).toBe(false);
  });

  it("captures a note with chunks, tags, and an embed job", () => {
    const item = captureNote(t.db, { body: "Buy tomato seeds\n\nAnd basil.", tags: ["Garden"] });
    expect(item.type).toBe("note");
    expect(item.title).toBe("Buy tomato seeds");
    expect(item.status).toBe("pending");
    expect(getItemTags(t.db, item.id)).toEqual(["garden"]);
    expect(getItemChunks(t.db, item.id)).toHaveLength(1);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["embed"]);
  });

  it("captures a link and queues fetch_link, rejecting bad urls", () => {
    const item = captureLink(t.db, { url: "https://example.test/x" });
    expect(item.type).toBe("link");
    expect(item.title).toBe("https://example.test/x");
    expect(item.sourceUrl).toBe("https://example.test/x");
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["fetch_link"]);
    expect(() => captureLink(t.db, { url: "notaurl" })).toThrow(CaptureError);
    expect(() => captureLink(t.db, { url: "ftp://x.test/a" })).toThrow(/http/);
  });

  it("captures a pdf, an image, an unknown file, and rejects audio", () => {
    const pdf = captureFile(t.db, { bytes: MINIMAL_PDF, name: "hello.pdf", mime: "application/pdf" });
    expect(pdf.type).toBe("file");
    expect(fs.existsSync(absoluteFilePath(pdf.filePath!))).toBe(true);
    expect(listJobs(t.db, { itemId: pdf.id }).map((j) => j.type)).toEqual(["extract_pdf"]);

    const img = captureFile(t.db, { bytes: Buffer.from("png"), name: "a.png", mime: "image/png" });
    expect(listJobs(t.db, { itemId: img.id }).map((j) => j.type)).toEqual(["ocr_image"]);

    const other = captureFile(t.db, { bytes: Buffer.from("txt"), name: "notes.txt", mime: "text/plain" });
    expect(listJobs(t.db, { itemId: other.id }).map((j) => j.type)).toEqual(["embed"]);
    expect(getItemChunks(t.db, other.id)).toHaveLength(1);

    expect(() => captureFile(t.db, { bytes: Buffer.from("aud"), name: "call.m4a", mime: "audio/mp4" })).toThrow(/meetings/);
    try {
      captureFile(t.db, { bytes: Buffer.from("aud"), name: "call.m4a", mime: "audio/mp4" });
    } catch (e) {
      expect((e as CaptureError).status).toBe(415);
    }
  });

  it("updates content, rechunks, retags, and requeues embedding", () => {
    const item = captureNote(t.db, { body: "first version" });
    const updated = updateItemContent(t.db, item.id, { title: "Renamed", body: "second version", tags: ["b", "a"] });
    expect(updated.title).toBe("Renamed");
    expect(getItemChunks(t.db, item.id)[0].text).toBe("Renamed second version");
    expect(getItemTags(t.db, item.id)).toEqual(["a", "b"]);
    expect(listJobs(t.db, { itemId: item.id }).map((j) => j.type)).toEqual(["embed", "embed"]);
    expect(() => updateItemContent(t.db, 999, { body: "x" })).toThrow(CaptureError);
  });
});
