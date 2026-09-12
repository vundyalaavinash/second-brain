import fs from "node:fs";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { enqueueJob } from "@/jobs/queue";
import { getItem, parseMeta, rechunkItem, updateItem } from "@/domain/items";
import { extractPdfText, type PdfExtractFn } from "@/domain/items/extract";
import { absoluteFilePath } from "@/lib/files";

export function createExtractPdfHandler(deps: { db: DB; extract?: PdfExtractFn }): JobHandler {
  const extract = deps.extract ?? extractPdfText;
  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(deps.db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    if (!item.filePath) throw new Error(`Item ${itemId} has no file`);

    updateItem(deps.db, itemId, { status: "processing" });
    const bytes = fs.readFileSync(absoluteFilePath(item.filePath));
    const { text, pageCount } = await extract(bytes);
    updateItem(deps.db, itemId, { extractedText: text, meta: { ...parseMeta(item), page_count: pageCount } });
    rechunkItem(deps.db, itemId);
    enqueueJob(deps.db, "embed", { itemId }, itemId);
  };
}
