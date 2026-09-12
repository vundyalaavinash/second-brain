import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { enqueueJob } from "@/jobs/queue";
import { getItem, rechunkItem, updateItem } from "@/domain/items";
import { ocrImageText, type OcrFn } from "@/domain/items/extract";
import { absoluteFilePath } from "@/lib/files";

export function createOcrImageHandler(deps: { db: DB; ocr?: OcrFn }): JobHandler {
  const ocr = deps.ocr ?? ocrImageText;
  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(deps.db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    if (!item.filePath) throw new Error(`Item ${itemId} has no file`);

    updateItem(deps.db, itemId, { status: "processing" });
    const text = await ocr(absoluteFilePath(item.filePath));
    updateItem(deps.db, itemId, { extractedText: text });
    rechunkItem(deps.db, itemId);
    enqueueJob(deps.db, "embed", { itemId }, itemId);
  };
}
