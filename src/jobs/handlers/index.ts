import type { DB } from "@/db/client";
import type { JobHandlers } from "@/jobs/worker";

export interface HandlerDeps {
  db: DB;
}

export function createJobHandlers(_deps: HandlerDeps): JobHandlers {
  return {};
}
