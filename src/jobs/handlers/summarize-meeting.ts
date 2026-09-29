import { z } from "zod";
import type { DB } from "@/db/client";
import type { JobHandler } from "@/jobs/worker";
import { jobPayload } from "@/jobs/payload";
import { getItem, parseMeta, updateItem } from "@/domain/items";
import { getChatProvider, type ChatProvider } from "@/providers/chat";

export const MeetingSummarySchema = z.object({
  summary: z.string().describe("One short paragraph covering what the meeting was about and where it got to."),
  decisions: z.array(z.string()).describe("What the meeting settled, one line each. Empty when it settled nothing."),
  proposed_actions: z
    .array(
      z.object({
        title: z.string().describe("The task, as an imperative line short enough for a to-do list."),
        notes: z.string().describe("Who owns it and by when, if the meeting said. Empty otherwise."),
      }),
    )
    .describe("Work the meeting left somebody holding. Empty when it left none."),
});

export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

const TOOL_NAME = "record_meeting_summary";

const SYSTEM = [
  "You summarise meeting transcripts for a personal knowledge base.",
  "Write in British English, in plain sentences, and stay with what was said: no advice, no filler, no invented names.",
  "The summary is one short paragraph. Decisions are the things the meeting settled, one line each, and none at all is a fine answer.",
  "Proposed actions are the things somebody now has to do, phrased as a task title with a note naming who and by when if the meeting said so.",
].join(" ");

export interface SummarizeMeetingDeps {
  db: DB;
  /**
   * Injected by tests and by anything that already holds a provider. Left out, the model is
   * resolved when the job runs, so one installed after boot takes effect without a restart;
   * passing null is a deliberate "there is none".
   */
  provider?: ChatProvider | null;
  log?: (message: string) => void;
}

interface MeetingMeta {
  summary?: MeetingSummary;
  summaryError?: string;
}

/**
 * The summary pass over a finished meeting: the final transcript plus whatever was typed into
 * the notes. It is the one job that is allowed to do nothing — without the local model
 * installed there is nothing to ask, and a meeting without a summary is still a meeting.
 */
export function createSummarizeMeetingHandler(deps: SummarizeMeetingDeps): JobHandler {
  const { db } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));

  return async (job) => {
    const { itemId } = jobPayload<{ itemId: number }>(job);
    const item = getItem(db, itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);

    const provider = deps.provider !== undefined ? deps.provider : getChatProvider();
    if (!provider) {
      log(`[summarize_meeting] no local summary model installed; item ${itemId} keeps its transcript without a summary`);
      return;
    }

    const transcript = item.extractedText.trim();
    const notes = item.body.trim();
    if (!transcript && !notes) {
      log(`[summarize_meeting] item ${itemId} has neither a transcript nor notes; nothing to summarise`);
      return;
    }

    const user = [
      `Meeting: ${item.title}`,
      "",
      transcript ? `Transcript:\n${transcript}` : "Transcript: none was recorded.",
      "",
      notes ? `Notes taken during the meeting:\n${notes}` : "Notes: none were taken.",
    ].join("\n");

    let summary: MeetingSummary;
    try {
      summary = await provider.structured({
        system: SYSTEM,
        user,
        schema: MeetingSummarySchema,
        name: TOOL_NAME,
        description: "Record the summary, the decisions, and the actions the meeting proposed.",
      });
    } catch (err) {
      // A summary is a nicety: a failure is recorded on the item and the job is done, rather
      // than retried three times and left red in the queue.
      const message = err instanceof Error ? err.message : String(err);
      const current = getItem(db, itemId);
      if (current) updateItem(db, itemId, { meta: { ...parseMeta<MeetingMeta>(current), summaryError: message } });
      log(`[summarize_meeting] item ${itemId} could not be summarised: ${message}`);
      return;
    }

    // Re-read: the person may have been typing notes while the model was thinking.
    const current = getItem(db, itemId);
    if (!current) throw new Error(`Item ${itemId} not found`);
    const next: MeetingMeta = { ...parseMeta<MeetingMeta>(current), summary };
    delete next.summaryError;
    updateItem(db, itemId, { meta: next as Record<string, unknown> });
  };
}
