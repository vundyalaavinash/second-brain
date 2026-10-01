import type { MeetingSummary } from "@/jobs/handlers/summarize-meeting";

export interface RecapInput {
  title: string;
  summary?: MeetingSummary;
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
      // The note carries who and by when when the meeting said so; appended rather than given its
      // own line so one action stays one line, which is what makes the list scannable.
      const note = action.notes?.trim();
      lines.push(note ? `- ${action.title.trim()} (${note})` : `- ${action.title.trim()}`);
    }
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
      notes?.trim(),
  );
}
