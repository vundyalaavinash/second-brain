import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items, itemPeople, people } from "@/db/schema";
import type { ContainerRef } from "@/domain/goals";
import { listContainers } from "./index";

/** A title word shorter than this is too common to say two things are related — the same
 * threshold `likeThisMinutesByTask` (`@/domain/focus`) already draws the line at, for the same
 * reason: matching on "the" or "for" would turn nearly every pair into a "match". */
const MIN_WORD_LENGTH = 4;

/** A name or title's words, lowercased and long enough to matter, deduplicated. */
function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= MIN_WORD_LENGTH));
}

function shareWord(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

/** What a meeting brings to the match — nothing more than its own title and who was on it. */
export interface MeetingSignal {
  title: string;
  attendeeNames: string[];
}

/**
 * Per meeting (by position in `list`), the one project or area its title or attendees point to
 * — or `null` when nothing does. Matching is deliberately dull, the same philosophy the forecast
 * slice's estimate hint (`likeThisMinutesByTask`) already established: a shared word of four or
 * more letters between the meeting title and a project/area name, or an attendee whose name
 * exactly matches (case-insensitively) a person already linked to that container. Never a
 * resource (design §6) — a resource is a reference shelf, not something a meeting reports to.
 * Never a best-effort guess: a container with no signal at all is not returned just because it
 * is the least-bad option.
 *
 * One query for the active projects and areas, one for the people already linked to them —
 * both read once for the whole list, not once per meeting, the same shape `focusMinutesByTask`,
 * `goalRefsByContainer`, and `likeThisMinutesByTask` already batch.
 */
export function suggestContainersFor(db: DB, list: MeetingSignal[]): (ContainerRef | null)[] {
  if (list.length === 0) return [];

  const candidates = listContainers(db, { status: "active" }).filter((c) => c.kind !== "resource");
  if (candidates.length === 0) return list.map(() => null);

  const containerIds = candidates.map((c) => c.id);
  const peopleRows = db
    .select({ containerId: items.containerId, name: people.name })
    .from(itemPeople)
    .innerJoin(items, eq(items.id, itemPeople.itemId))
    .innerJoin(people, eq(people.id, itemPeople.personId))
    .where(inArray(items.containerId, containerIds))
    .all();

  const namesByContainer = new Map<number, Set<string>>();
  for (const row of peopleRows) {
    if (row.containerId === null) continue;
    const set = namesByContainer.get(row.containerId);
    const name = row.name.trim().toLowerCase();
    if (set) set.add(name);
    else namesByContainer.set(row.containerId, new Set([name]));
  }

  const withWords = candidates.map((c) => ({ ref: { id: c.id, name: c.name, slug: c.slug, kind: c.kind } as ContainerRef, words: significantWords(c.name) }));

  return list.map((meeting) => {
    const titleWords = significantWords(meeting.title);
    const attendeeNames = meeting.attendeeNames.map((n) => n.trim().toLowerCase()).filter(Boolean);

    let best: ContainerRef | null = null;
    let bestScore = 0;
    for (const { ref, words } of withWords) {
      const wordMatch = titleWords.size > 0 && shareWord(titleWords, words);
      const attendeeMatch = attendeeNames.some((n) => namesByContainer.get(ref.id)?.has(n));
      if (!wordMatch && !attendeeMatch) continue;
      const score = (wordMatch ? 1 : 0) + (attendeeMatch ? 1 : 0);
      if (score > bestScore) {
        best = ref;
        bestScore = score;
      }
    }
    return best;
  });
}

/**
 * The single-meeting read `suggestContainersFor` batches — for one meeting looked at on its own,
 * such as a test. Never call this from a loop over a list of meetings: that turns the two
 * queries above back into two per meeting, exactly the shape this repository's reviews keep
 * flagging.
 */
export function suggestContainer(db: DB, meeting: MeetingSignal): ContainerRef | null {
  return suggestContainersFor(db, [meeting])[0] ?? null;
}
