import type { DB } from "@/db/client";
import type { JobHandlers } from "@/jobs/worker";
import type { EmbedProvider } from "@/providers/embed/types";
import { createEmbedHandler } from "./embed";

export interface HandlerDeps {
  db: DB;
  embed: EmbedProvider | null;
}

export function createJobHandlers(deps: HandlerDeps): JobHandlers {
  return {
    embed: createEmbedHandler({ db: deps.db, embed: deps.embed }),
  };
}
