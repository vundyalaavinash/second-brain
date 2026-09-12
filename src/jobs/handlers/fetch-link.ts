import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { enqueueJob } from "@/jobs/queue";
import { getItem, parseMeta, rechunkItem, updateItem } from "@/domain/items";
import { fetchPage, type FetchLike } from "@/domain/items/links";
import { nowIso } from "@/lib/time";

export function createFetchLinkHandler(deps: { db: DB; fetchImpl?: FetchLike }): JobHandler {
  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(deps.db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    if (!item.sourceUrl) throw new Error(`Item ${itemId} has no source url`);

    updateItem(deps.db, itemId, { status: "processing" });
    const page = await fetchPage(item.sourceUrl, deps.fetchImpl);
    const keepTitle = item.title.trim() !== "" && item.title !== item.sourceUrl;
    updateItem(deps.db, itemId, {
      title: keepTitle ? item.title : page.title,
      extractedText: page.text,
      meta: { ...parseMeta(item), site_name: page.siteName, byline: page.byline, fetched_at: nowIso() },
    });
    rechunkItem(deps.db, itemId);
    enqueueJob(deps.db, "embed", { itemId }, itemId);
  };
}
