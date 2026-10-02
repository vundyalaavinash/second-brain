/**
 * Combining the per-part summaries of a transcript too long to summarise in one pass.
 *
 * This is done mechanically, not by asking the model to merge. A model-driven merge reads better
 * and could collapse two wordings of one decision -- but it can also quietly drop an item, and a
 * summary assembled from parts is exactly where that would be impossible to notice. So the lists
 * are unioned here, in code, and the model is only asked for the narrative paragraph.
 *
 * The same reasoning sets how aggressive the de-duplication is: only entries identical once case,
 * spacing and trailing punctuation are normalised away. Two decisions that merely look alike stay
 * two decisions. A visible duplicate is something a person can ignore; a dropped decision is not
 * something they can even see.
 */

export interface SummaryPart {
  summary?: string;
  decisions?: string[];
  proposed_actions?: { title: string; notes?: string }[];
}

export interface MergedSummary {
  summary: string;
  decisions: string[];
  proposed_actions: { title: string; notes: string }[];
}

/** What two entries have to match on to count as the same entry. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "")
    .trim();
}

/**
 * One summary covering every part, with the lists unioned in the order things were first said.
 *
 * `narrative` is the reduce pass's paragraph. Left out or blank -- which is what happens when that
 * call fails, and it is allowed to fail -- the parts' own paragraphs are kept instead: longer than
 * one paragraph, but a complete account rather than none.
 */
export function mergeSummaries(parts: SummaryPart[], narrative?: string): MergedSummary {
  const decisions: string[] = [];
  const seenDecisions = new Set<string>();

  const actions: { title: string; notes: string }[] = [];
  const actionIndex = new Map<string, number>();

  for (const part of parts) {
    for (const decision of part.decisions ?? []) {
      const text = decision.trim();
      if (!text) continue;
      const key = normalise(text);
      if (seenDecisions.has(key)) continue;
      seenDecisions.add(key);
      decisions.push(text);
    }

    for (const action of part.proposed_actions ?? []) {
      const title = action.title.trim();
      if (!title) continue;
      const notes = (action.notes ?? "").trim();
      const key = normalise(title);
      const existing = actionIndex.get(key);
      if (existing === undefined) {
        actionIndex.set(key, actions.length);
        actions.push({ title, notes });
        continue;
      }
      // Only one of the parts that saw this action may have heard who owned it.
      if (!actions[existing].notes && notes) actions[existing].notes = notes;
    }
  }

  const written = narrative?.trim();
  const summary = written || parts.map((p) => p.summary?.trim()).filter(Boolean).join("\n\n");

  return { summary, decisions, proposed_actions: actions };
}
