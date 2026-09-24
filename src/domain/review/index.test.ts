import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { listItems } from "@/domain/items";
import { REVIEW_STEPS, getReview, openReview, saveReviewStep, reviewAnswers, renderReviewBody, nextStep, type ReviewAnswers } from "./index";

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
    expect(item.title).toMatch(/21 September/);
    expect(item.status).toBe("ready");
    expect(item.reviewWeek).toBe("2026-09-21");
  });

  it("opens a different item for a different week", () => {
    const a = openReview(t.db, "2026-09-21");
    const b = openReview(t.db, "2026-09-28");
    expect(b.id).not.toBe(a.id);
    expect(listItems(t.db, { type: "review" })).toHaveLength(2);
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
  it("labels a goal note by id with no snapshot, and by title with one", () => {
    const answers: ReviewAnswers = { goals: { "7": "Slipped a week." } };
    expect(renderReviewBody("2026-09-21", answers)).toContain("Goal 7");
    expect(renderReviewBody("2026-09-21", answers, { goalTitles: { "7": "Launch v2" } })).toContain("Launch v2");
  });
});
