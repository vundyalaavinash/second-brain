import { getDb } from "@/db/client";
import { predictionsPayload } from "@/lib/predictions";
import { LogPage } from "@/components/predictions/log-page";

export const dynamic = "force-dynamic";

/** Open rows first, because the log's only real job is getting them scored. */
export default function Log() {
  return <LogPage initial={predictionsPayload(getDb(), { state: "open" }, new Date())} />;
}
