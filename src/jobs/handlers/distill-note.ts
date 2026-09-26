import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { getItem, mergeItemMeta } from "@/domain/items";
import { buildDistillation } from "@/domain/distill";
import { getGistProvider, type GistProvider } from "@/providers/gist";

export interface DistillNoteDeps {
  db: DB;
  /** Injected by tests; left out, the provider is resolved when the job runs so a model file
   * added after boot takes effect without a restart. Passing null is a deliberate "there is none". */
  gist?: GistProvider | null;
  log?: (message: string) => void;
}

export function createDistillNoteHandler(deps: DistillNoteDeps): JobHandler {
  const { db } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));

  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);

    const gist = deps.gist !== undefined ? deps.gist : getGistProvider();
    if (!gist) {
      log(`[distill_note] no local gist model; item ${itemId} keeps no distillation`);
      return;
    }

    const distillation = await buildDistillation(item, gist);
    // Re-read: the person may have edited the item while the model was thinking.
    const current = getItem(db, itemId);
    if (!current) throw new Error(`Item ${itemId} not found`);
    mergeItemMeta(db, itemId, {
      distillation: distillation ?? { gist: "", quotes: [], generatedAt: new Date().toISOString(), status: "dismissed" },
    });
  };
}
