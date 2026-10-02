/**
 * Deliberately not `MeetingSummary` itself: summaries written before a field existed are still on
 * disk and still worth a recap, so everything past `summary` is optional here. The generation
 * schema stays strict -- it is only reading that has to cope with history.
 */
export interface StoredSummary {
  summary?: string;
  decisions?: string[];
  proposed_actions?: { title: string; owner?: string; deadline?: string; notes?: string }[];
  risks?: string[];
  open_questions?: string[];
}

export interface RecapInput {
  title: string;
  summary?: StoredSummary;
  /** What the person typed themselves, which outranks anything the model inferred. */
  notes?: string;
}

/**
 * The written recap to send after a meeting: what was decided, who now holds what, and what is
 * still open, in a shape someone can paste into mail or chat without editing it first.
 *
 * Sections with nothing in them are left out rather than printed empty. A recap that says
 * "Decisions:" followed by a blank line reads as a tool that failed, and the point of sending one
 * is to invite correction -- which only works if what is there is worth reading.
 *
 * The closing line is deliberate and not decoration: the recap's job is to surface a
 * misunderstanding while it is still cheap to fix, so it has to ask.
 */
export function meetingRecap(input: RecapInput): string {
  const { title, summary, notes } = input;
  const lines: string[] = [];

  lines.push(`Recap — ${title}`, "");

  if (summary?.summary?.trim()) {
    lines.push(summary.summary.trim(), "");
  }

  const decisions = (summary?.decisions ?? []).filter((d) => d.trim());
  if (decisions.length > 0) {
    lines.push("Decisions:");
    for (const decision of decisions) lines.push(`- ${decision.trim()}`);
    lines.push("");
  }

  const actions = (summary?.proposed_actions ?? []).filter((a) => a.title.trim());
  if (actions.length > 0) {
    lines.push("Action items:");
    for (const action of actions) {
      // Owner and deadline are appended to the action's own line rather than given lines of their
      // own, so the list stays scannable -- and a missing one is visible as an absence, which is
      // the whole point of asking for them separately.
      const qualifiers = [action.owner?.trim(), action.deadline?.trim(), action.notes?.trim()].filter(Boolean);
      lines.push(qualifiers.length > 0 ? `- ${action.title.trim()} (${qualifiers.join(", ")})` : `- ${action.title.trim()}`);
    }
    lines.push("");
  }

  const risks = (summary?.risks ?? []).filter((r) => r.trim());
  if (risks.length > 0) {
    lines.push("Risks / dependencies:");
    for (const risk of risks) lines.push(`- ${risk.trim()}`);
    lines.push("");
  }

  const questions = (summary?.open_questions ?? []).filter((q) => q.trim());
  if (questions.length > 0) {
    lines.push("Open questions:");
    for (const question of questions) lines.push(`- ${question.trim()}`);
    lines.push("");
  }

  if (notes?.trim()) {
    lines.push("My notes:", notes.trim(), "");
  }

  lines.push("Please correct me if I missed anything.");
  return lines.join("\n");
}

/** Nothing worth sending: no summary, no decisions, no actions, no notes of one's own. */
export function hasRecapContent(input: RecapInput): boolean {
  const { summary, notes } = input;
  return Boolean(
    summary?.summary?.trim() ||
      (summary?.decisions ?? []).some((d) => d.trim()) ||
      (summary?.proposed_actions ?? []).some((a) => a.title.trim()) ||
      (summary?.risks ?? []).some((r) => r.trim()) ||
      (summary?.open_questions ?? []).some((q) => q.trim()) ||
      notes?.trim(),
  );
}
