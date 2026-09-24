import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DB } from "@/db/client";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, listItems } from "@/domain/items";
import {
  REVIEW_STEPS,
  getReview,
  openReview,
  saveReviewStep,
  reviewAnswers,
  reviewSnapshot,
  renderReviewBody,
  nextStep,
  type ReviewAnswers,
  type ReviewSnapshot,
} from "./index";

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
});
afterEach(() => t.cleanup());

describe("openReview", () => {
  it("opens the same item twice for the same week", () => {
    const a = openReview(t.db, "2026-09-21");
    const b = openReview(t.db, "2026-09-21");
    expect(b.id).toBe(a.id);
    expect(listItems(t.db, { type: "review" })).toHaveLength(1);
  });

  it("titles the item after the week and needs no processing", () => {
    const item = openReview(t.db, "2026-09-21");
    expect(item.type).toBe("review");
    expect(item.title).toBe("Week of 21 September 2026");
    expect(item.status).toBe("ready");
    expect(item.reviewWeek).toBe("2026-09-21");
  });

  it("opens a different item for a different week", () => {
    const a = openReview(t.db, "2026-09-21");
    const b = openReview(t.db, "2026-09-28");
    expect(b.id).not.toBe(a.id);
    expect(listItems(t.db, { type: "review" })).toHaveLength(2);
  });

  // getReview filters on type = "review", so a row that holds the same reviewWeek under a
  // different type is invisible to the select-first shortcut. openReview's insert then hits the
  // unique index on reviewWeek for real, and the catch can't explain it away — the re-select
  // still finds nothing of type "review" — so it rethrows the genuine SqliteError rather than
  // masking it as success.
  it("rethrows a unique-index collision it cannot resolve by re-selecting", () => {
    createItem(t.db, { type: "note", title: "squatter", reviewWeek: "2026-09-21" });
    expect(() => openReview(t.db, "2026-09-21")).toThrow(/UNIQUE/i);
  });

  // Simulates the race two tabs can genuinely lose to: a `createItem` that performs the real
  // insert (another tab's write landing first, from this call's point of view) and then throws,
  // the exact shape of a failed insert that nonetheless left a row behind. `vi.doMock` + a fresh
  // dynamic import is needed because `openReview` binds `createItem` at its own module load.
  it("returns the winner's row when the insert races and loses", async () => {
    vi.resetModules();
    vi.doMock("@/domain/items", async () => {
      const actual = await vi.importActual<typeof import("@/domain/items")>("@/domain/items");
      return {
        ...actual,
        createItem: (db: DB, input: Parameters<typeof actual.createItem>[1]) => {
          actual.createItem(db, input);
          throw new Error("lost the race");
        },
      };
    });
    try {
      const mod = await import("./index");
      const item = mod.openReview(t.db, "2026-09-21");
      expect(item.reviewWeek).toBe("2026-09-21");
      expect(listItems(t.db, { type: "review" })).toHaveLength(1);
    } finally {
      vi.doUnmock("@/domain/items");
      vi.resetModules();
    }
  });
});

describe("saveReviewStep", () => {
  it("keeps each step's answer and leaves the others alone", () => {
    openReview(t.db, "2026-09-21");
    saveReviewStep(t.db, "2026-09-21", "back", "Shipped the API.");
    saveReviewStep(t.db, "2026-09-21", "ahead", "Start the docs.");
    expect(reviewAnswers(getReview(t.db, "2026-09-21")!)).toMatchObject({ back: "Shipped the API.", ahead: "Start the docs." });
  });

  it("keeps a note per goal under the goals step", () => {
    openReview(t.db, "2026-09-21");
    saveReviewStep(t.db, "2026-09-21", "goals", { "7": "Slipped a week." });
    expect(reviewAnswers(getReview(t.db, "2026-09-21")!).goals).toEqual({ "7": "Slipped a week." });
  });

  it("merges a second goal's note in rather than replacing the first goal's", () => {
    openReview(t.db, "2026-09-21");
    saveReviewStep(t.db, "2026-09-21", "goals", { "7": "Slipped a week." });
    saveReviewStep(t.db, "2026-09-21", "goals", { "3": "On track." });
    expect(reviewAnswers(getReview(t.db, "2026-09-21")!).goals).toEqual({ "7": "Slipped a week.", "3": "On track." });
  });

  it("rewrites the body as readable Markdown on every save", () => {
    openReview(t.db, "2026-09-21");
    saveReviewStep(t.db, "2026-09-21", "back", "Shipped the API.");
    expect(getReview(t.db, "2026-09-21")!.body).toContain("Shipped the API.");
  });

  it("opens the review itself when nothing has been opened yet", () => {
    saveReviewStep(t.db, "2026-09-21", "clear", "Inbox is empty.");
    expect(getReview(t.db, "2026-09-21")).toBeDefined();
  });

  it("does not leak a stored snapshot into the answers", () => {
    openReview(t.db, "2026-09-21");
    const snapshot: ReviewSnapshot = { done: 3, dropped: 1, slipped: 2, focusMinutes: 90, focusRuns: 4, meetings: 5, projects: [] };
    saveReviewStep(t.db, "2026-09-21", "back", "Shipped the API.", snapshot);
    const item = getReview(t.db, "2026-09-21")!;
    expect(reviewAnswers(item)).toEqual({ back: "Shipped the API." });
    expect(reviewSnapshot(item)).toEqual(snapshot);
  });

  it("keeps the last snapshot saved when a later save gives none", () => {
    openReview(t.db, "2026-09-21");
    const snapshot: ReviewSnapshot = { done: 3, dropped: 1, slipped: 2, focusMinutes: 90, focusRuns: 4, meetings: 5, projects: [] };
    saveReviewStep(t.db, "2026-09-21", "back", "Shipped the API.", snapshot);
    saveReviewStep(t.db, "2026-09-21", "ahead", "Start the docs.");
    const item = getReview(t.db, "2026-09-21")!;
    expect(reviewSnapshot(item)).toEqual(snapshot);
    expect(reviewAnswers(item)).toEqual({ back: "Shipped the API.", ahead: "Start the docs." });
  });
});

describe("nextStep", () => {
  it("resumes a half-finished review at the step after the last one answered", () => {
    openReview(t.db, "2026-09-21");
    saveReviewStep(t.db, "2026-09-21", "clear", "done");
    expect(nextStep(reviewAnswers(getReview(t.db, "2026-09-21")!))).toBe("back");
  });

  it("starts at the first step with nothing answered", () => {
    expect(nextStep({})).toBe(REVIEW_STEPS[0]);
  });

  it("stays on the last step once every step is answered", () => {
    const answers: ReviewAnswers = { clear: "a", back: "b", goals: {}, ahead: "d" };
    expect(nextStep(answers)).toBe("ahead");
  });
});

describe("renderReviewBody", () => {
  it("labels a goal note by id", () => {
    const answers: ReviewAnswers = { goals: { "7": "Slipped a week." } };
    expect(renderReviewBody("2026-09-21", answers)).toContain("Goal 7");
  });
});
