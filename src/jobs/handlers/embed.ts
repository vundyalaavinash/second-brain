import type { DB } from "@/db/client";
import type { EmbedProvider } from "@/providers/embed/types";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { getItem, getItemChunks, updateItem } from "@/domain/items";
import { upsertChunkVectors } from "@/domain/search/vectors";

const BATCH = 16;

export function createEmbedHandler(deps: { db: DB; embed: EmbedProvider | null }): JobHandler {
  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(deps.db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    if (!deps.embed) {
      console.warn(`[embed] no embedding provider; item ${itemId} indexed for keyword search only`);
      updateItem(deps.db, itemId, { status: "ready", error: null });
      return;
    }
    updateItem(deps.db, itemId, { status: "processing" });
    const rows = getItemChunks(deps.db, itemId);
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const vectors = await deps.embed.embed(batch.map((c) => c.text));
      upsertChunkVectors(
        deps.db,
        batch.map((c, j) => ({ chunkId: c.id, vector: vectors[j] })),
      );
    }
    updateItem(deps.db, itemId, { status: "ready", error: null });
  };
}
