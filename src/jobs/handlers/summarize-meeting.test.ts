import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, parseMeta, updateItem } from "@/domain/items";
import { enqueueJob } from "@/jobs/queue";
import type { Job } from "@/db/schema";
import type { ChatProvider } from "@/providers/chat";
import { createSummarizeMeetingHandler, MeetingSummarySchema } from "./summarize-meeting";

const SUMMARY = {
  summary: "The team agreed to ship the recorder on Friday.",
  decisions: ["Ship on Friday", "Drop the second microphone"],
  proposed_actions: [
    { title: "Write the release note", notes: "Ada offered" },
    { title: "Check the model download", notes: "" },
  ],
};

interface MeetingMeta {
  summary?: typeof SUMMARY;
  summaryError?: string;
  recording?: { state: string };
}

describe("summarize_meeting handler", () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
    // The default provider resolves from the environment; no test may reach the real API.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    t.cleanup();
  });

  function meeting(over: { extractedText?: string; body?: string } = {}) {
    const item = createItem(t.db, {
      type: "meeting",
      title: "Product sync",
      body: over.body ?? "## Notes\n\nAda wants the recorder shipped.",
      status: "ready",
      meta: { recording: { state: "done" } },
    });
    return updateItem(t.db, item.id, { extractedText: over.extractedText ?? "We agreed to ship on Friday." });
  }

  function job(itemId: number): Job {
    return enqueueJob(t.db, "summarize_meeting", { itemId }, itemId);
  }

  it("writes meta.summary from the provider's structured answer", async () => {
    const item = meeting();
    const calls: { system: string; user: string; name: string }[] = [];
    const provider: ChatProvider = {
      structured: async (req) => {
        calls.push({ system: req.system, user: req.user, name: req.name });
        return MeetingSummarySchema.parse(SUMMARY) as never;
      },
    };
    const handler = createSummarizeMeetingHandler({ db: t.db, provider });

    await handler(job(item.id));

    const meta = parseMeta<MeetingMeta>(getItem(t.db, item.id)!);
    expect(meta.summary).toEqual(SUMMARY);
    expect(meta.summaryError).toBeUndefined();
    // The recorder's own meta survives the merge.
    expect(meta.recording?.state).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain("We agreed to ship on Friday.");
    expect(calls[0].user).toContain("Ada wants the recorder shipped.");
    expect(calls[0].system).toMatch(/summarise meeting transcripts/i);
  });

  it("skips with one log line and no changes when there is no provider", async () => {
    const item = meeting();
    const logs: string[] = [];
    const handler = createSummarizeMeetingHandler({ db: t.db, provider: null, log: (m) => logs.push(m) });

    await handler(job(item.id));

    const meta = parseMeta<MeetingMeta>(getItem(t.db, item.id)!);
    expect(meta.summary).toBeUndefined();
    expect(meta.summaryError).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/local summary model/i);
  });

  it("skips when no local model resolves and no provider was injected", async () => {
    const item = meeting();
    const logs: string[] = [];
    const handler = createSummarizeMeetingHandler({ db: t.db, log: (m) => logs.push(m) });

    await handler(job(item.id));

    expect(parseMeta<MeetingMeta>(getItem(t.db, item.id)!).summary).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("records meta.summaryError and resolves when the provider fails", async () => {
    const item = meeting();
    const provider: ChatProvider = {
      structured: async () => {
        throw new Error("overloaded_error");
      },
    };
    const logs: string[] = [];
    const handler = createSummarizeMeetingHandler({ db: t.db, provider, log: (m) => logs.push(m) });

    await expect(handler(job(item.id))).resolves.toBeUndefined();

    const meta = parseMeta<MeetingMeta>(getItem(t.db, item.id)!);
    expect(meta.summaryError).toMatch(/overloaded_error/);
    expect(meta.summary).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it("clears a previous summaryError on the next success", async () => {
    const item = meeting();
    const failing = createSummarizeMeetingHandler({
      db: t.db,
      provider: { structured: async () => { throw new Error("nope"); } },
      log: () => {},
    });
    await failing(job(item.id));
    expect(parseMeta<MeetingMeta>(getItem(t.db, item.id)!).summaryError).toBeTruthy();

    const ok = createSummarizeMeetingHandler({
      db: t.db,
      provider: { structured: async () => MeetingSummarySchema.parse(SUMMARY) as never },
    });
    await ok(job(item.id));

    const meta = parseMeta<MeetingMeta>(getItem(t.db, item.id)!);
    expect(meta.summaryError).toBeUndefined();
    expect(meta.summary).toEqual(SUMMARY);
  });

  it("skips an item with neither a transcript nor notes", async () => {
    const item = createItem(t.db, { type: "meeting", title: "Empty", body: "", status: "ready" });
    const structured = vi.fn();
    const logs: string[] = [];
    const handler = createSummarizeMeetingHandler({ db: t.db, provider: { structured }, log: (m) => logs.push(m) });

    await handler(job(item.id));

    expect(structured).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
  });
});
