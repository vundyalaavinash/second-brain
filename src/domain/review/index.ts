import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, type Item } from "@/db/schema";
import { createItem, parseMeta, updateItem } from "@/domain/items";
import { weekLabel } from "@/lib/week";

/** The four questions a review walks through, in the order it walks them. */
export const REVIEW_STEPS = ["clear", "back", "goals", "ahead"] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** What a review has answered so far. `goals` is a note per goal id, since a week can speak to
 * several goals at once where every other step is a single piece of prose. */
export type ReviewAnswers = {
  clear?: string;
  back?: string;
  goals?: Record<string, string>;
  ahead?: string;
};

/** Goal titles for `renderReviewBody` to label the goals section with. Optional: a caller with
 * no titles handy still gets a readable body, just labelled by id instead of by name. */
export interface ReviewSnapshot {
  goalTitles?: Record<string, string>;
}

const STEP_HEADINGS: Record<ReviewStep, string> = {
  clear: "Clear the decks",
  back: "Look back",
  goals: "Goals",
  ahead: "Look ahead",
};

/** The week's review item, if one has been opened yet. */
export function getReview(db: DB, week: string): Item | undefined {
  return db
    .select()
    .from(items)
    .where(and(eq(items.type, "review"), eq(items.reviewWeek, week)))
    .get();
}

/**
 * Get-or-create, safe against two tabs opening the same week at once: the select runs first, and
 * only a select that finds nothing tries the insert. `reviewWeek` carries the unique index that
 * makes a second insert for the same week fail — rather than let that surface as an error to
 * whichever tab loses the race, the failure is caught and the row it collided with is re-read,
 * so both tabs land on the one item either way. A failure the re-select still can't explain (the
 * database is genuinely gone, say) is not swallowed: it is rethrown as itself.
 */
export function openReview(db: DB, week: string): Item {
  const existing = getReview(db, week);
  if (existing) return existing;
  try {
    return createItem(db, { type: "review", title: weekLabel(week), status: "ready", reviewWeek: week });
  } catch (err) {
    const afterAll = getReview(db, week);
    if (afterAll) return afterAll;
    throw err;
  }
}

/** The answers an item's meta holds, however many steps have been saved so far. */
export function reviewAnswers(item: Item): ReviewAnswers {
  return parseMeta<ReviewAnswers>(item);
}

/** Where a review resumes: the first step with no answer yet, or the last step once every one
 * of them has been. */
export function nextStep(answers: ReviewAnswers): ReviewStep {
  return REVIEW_STEPS.find((step) => answers[step] === undefined) ?? REVIEW_STEPS[REVIEW_STEPS.length - 1];
}

/**
 * The review as readable Markdown, rebuilt whole on every save rather than patched in place —
 * the source of truth is the answers in meta, and the body is only ever a rendering of them, so
 * there is never a chance for the two to say different things.
 */
export function renderReviewBody(week: string, answers: ReviewAnswers, snapshot?: ReviewSnapshot): string {
  const lines: string[] = [`# ${weekLabel(week)}`, ""];
  for (const step of REVIEW_STEPS) {
    lines.push(`## ${STEP_HEADINGS[step]}`, "");
    if (step === "goals") {
      const goals = answers.goals ?? {};
      const ids = Object.keys(goals);
      if (ids.length === 0) lines.push("_Nothing noted yet._");
      else for (const id of ids) lines.push(`- **${snapshot?.goalTitles?.[id] ?? `Goal ${id}`}**: ${goals[id]}`);
    } else {
      lines.push(answers[step] ?? "_Nothing noted yet._");
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Saves one step's answer and rewrites the body to match. Every step but `goals` replaces its
 * one answer outright; `goals` merges the given notes into whatever goals already had one, so
 * saving a note for goal 7 never loses the note already sitting on goal 3.
 */
export function saveReviewStep(
  db: DB,
  week: string,
  step: ReviewStep,
  value: string | Record<string, string>,
  snapshot?: ReviewSnapshot,
): Item {
  const item = openReview(db, week);
  const current = reviewAnswers(item);
  const answers: ReviewAnswers =
    step === "goals" ? { ...current, goals: { ...current.goals, ...(value as Record<string, string>) } } : { ...current, [step]: value as string };
  return updateItem(db, item.id, { meta: answers, body: renderReviewBody(week, answers, snapshot) });
}
