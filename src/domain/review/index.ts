import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { REVIEW_STEPS, type ReviewStep } from "@/db/enums";
import { items, type Item } from "@/db/schema";
import { createItem, parseMeta, updateItem } from "@/domain/items";
import { weekLabel } from "@/lib/week";

export { REVIEW_STEPS, type ReviewStep };

/** What a review has answered so far. `goals` is a note per goal id, since a week can speak to
 * several goals at once where every other step is a single piece of prose. */
export type ReviewAnswers = {
  clear?: string;
  back?: string;
  goals?: Record<string, string>;
  ahead?: string;
};

/**
 * A frozen picture of the week the review was written against — done, dropped, still open,
 * booked focus time, the projects that moved. Design §5.2: the record is the four free-text
 * answers as its body, and a snapshot of the figures in its meta, so a review read back long
 * after the underlying tasks and containers have moved on still says what the week actually
 * looked like when the prose was written, not what today's live query happens to say now.
 */
export interface ReviewSnapshot {
  done: number;
  dropped: number;
  slipped: number;
  focusMinutes: number;
  focusRuns: number;
  meetings: number;
  projects: { containerId: number; name: string; closed: number; percent: number }[];
}

/**
 * What a review item's meta actually holds: the answers and the snapshot each under their own
 * key. `reviewAnswers` reads only `.answers` — never the whole blob — so any key meta ever grows
 * (the snapshot included) cannot leak into what a caller treats as "the answers".
 */
interface ReviewMeta {
  answers?: ReviewAnswers;
  snapshot?: ReviewSnapshot;
}

const STEP_HEADINGS: Record<ReviewStep, string> = {
  clear: "Clear the decks",
  back: "Look back",
  goals: "Goals",
  ahead: "Look ahead",
};

function reviewMeta(item: Item): ReviewMeta {
  return parseMeta<ReviewMeta>(item);
}

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

/** The answers an item's meta holds, however many steps have been saved so far — never anything
 * else meta carries, the snapshot included. */
export function reviewAnswers(item: Item): ReviewAnswers {
  return reviewMeta(item).answers ?? {};
}

/** The figures the review was last saved against, if any save has carried one — undefined for a
 * review nothing has saved a snapshot into yet. */
export function reviewSnapshot(item: Item): ReviewSnapshot | undefined {
  return reviewMeta(item).snapshot;
}

/** Where a review resumes: the first step with no answer yet, or the last step once every one
 * of them has been. */
export function nextStep(answers: ReviewAnswers): ReviewStep {
  return REVIEW_STEPS.find((step) => answers[step] === undefined) ?? REVIEW_STEPS[REVIEW_STEPS.length - 1];
}

/**
 * The review as readable Markdown, rebuilt whole on every save rather than patched in place —
 * the source of truth is the answers in meta, and the body is only ever a rendering of them, so
 * there is never a chance for the two to say different things. A goal note is labelled by id: the
 * body is not the place to resolve a goal's current title, which the snapshot in meta — not this
 * function — is what freezes for later reading.
 */
export function renderReviewBody(week: string, answers: ReviewAnswers): string {
  const lines: string[] = [`# ${weekLabel(week)}`, ""];
  for (const step of REVIEW_STEPS) {
    lines.push(`## ${STEP_HEADINGS[step]}`, "");
    if (step === "goals") {
      const goals = answers.goals ?? {};
      const ids = Object.keys(goals);
      if (ids.length === 0) lines.push("_Nothing noted yet._");
      else for (const id of ids) lines.push(`- **Goal ${id}**: ${goals[id]}`);
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
 *
 * `snapshot`, when given, replaces the figures frozen in meta — the caller's own read of the
 * week at the moment of this save. Left out, whatever snapshot the item already carried survives
 * the write untouched, so an early step's save (with no figures to hand yet) cannot erase a
 * later one's.
 */
export function saveReviewStep(db: DB, week: string, step: ReviewStep, value: string | Record<string, string>, snapshot?: ReviewSnapshot): Item {
  const item = openReview(db, week);
  const meta = reviewMeta(item);
  const current = meta.answers ?? {};
  const answers: ReviewAnswers =
    step === "goals" ? { ...current, goals: { ...current.goals, ...(value as Record<string, string>) } } : { ...current, [step]: value as string };
  const nextMeta: ReviewMeta = { answers, snapshot: snapshot ?? meta.snapshot };
  return updateItem(db, item.id, { meta: nextMeta as unknown as Record<string, unknown>, body: renderReviewBody(week, answers) });
}
