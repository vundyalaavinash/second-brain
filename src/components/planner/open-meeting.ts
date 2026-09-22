/** Opens a meeting's note, creating it on first open. Returns the item id, or null if the
 * capture failed. Shared by the timeline, the week columns, and the meetings list. */
export async function openMeeting(meetingId: number): Promise<number | null> {
  const res = await fetch(`/api/activity/meetings/${meetingId}/capture`, { method: "POST" });
  if (!res.ok) return null;
  const item = (await res.json()) as { id: number };
  return item.id;
}

/** "4 meetings", "1 meeting". The app writes its own plurals rather than pulling in Intl. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
