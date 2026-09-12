import fs from "node:fs";
import { modelsDir } from "@/lib/paths";

export type PdfExtractFn = (bytes: Buffer) => Promise<{ text: string; pageCount: number }>;
export type OcrFn = (absolutePath: string) => Promise<string>;

/** Text of every page, joined, with pdf-parse's "-- n of m --" separators removed. */
export const extractPdfText: PdfExtractFn = async (bytes) => {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    const text = result.text
      .replace(/^-- \d+ of \d+ --$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
};

/** OCR with tesseract.js. Language data is cached under the models directory on first use. */
export const ocrImageText: OcrFn = async (absolutePath) => {
  const { createWorker } = await import("tesseract.js");
  fs.mkdirSync(modelsDir(), { recursive: true });
  const worker = await createWorker("eng", undefined, { cachePath: modelsDir() });
  try {
    const { data } = await worker.recognize(absolutePath);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
};
