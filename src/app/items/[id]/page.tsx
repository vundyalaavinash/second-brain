import fs from "node:fs";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { calendarEvents, type CalendarEvent, type Item } from "@/db/schema";
import { getItem, parseMeta } from "@/domain/items";
import { listTasks } from "@/domain/tasks";
import { hasSummaryModel } from "@/providers/chat";
import { absoluteFilePath } from "@/lib/files";
import { serializeItem, serializeMeetingResolved, serializeTasks } from "@/lib/api";
import { ItemEditor } from "@/components/item-editor";
import { MeetingPage } from "@/components/meeting/meeting-page";

export const dynamic = "force-dynamic";

/** The calendar row this meeting was captured from: by the link the capture set, or by the
 * id the item recorded before that link existed. */
function eventForItem(db: DB, item: Item): CalendarEvent | undefined {
  const linked = db.select().from(calendarEvents).where(eq(calendarEvents.itemId, item.id)).get();
  if (linked) return linked;
  const eventId = parseMeta<{ calendarEventId?: number }>(item).calendarEventId;
  if (!eventId) return undefined;
  return db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
}

/** The size of the recorded WAV, or null when there is none to stat. */
function recordingBytes(item: Item): number | null {
  const wavPath = parseMeta<{ recording?: { wavPath?: string } }>(item).recording?.wavPath;
  if (!wavPath) return null;
  try {
    return fs.statSync(absoluteFilePath(wavPath)).size;
  } catch {
    return null;
  }
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const db = getDb();
  const item = getItem(db, n);
  if (!item) notFound();

  if (item.type === "meeting") {
    const event = eventForItem(db, item);
    return (
      <MeetingPage
        key={item.id}
        item={serializeItem(db, item)}
        event={event ? serializeMeetingResolved(db, event) : null}
        tasks={serializeTasks(db, listTasks(db, { sourceItemId: item.id, status: "all" }))}
        hasSummaryModel={hasSummaryModel()}
        recordingBytes={recordingBytes(item)}
      />
    );
  }

  return <ItemEditor key={item.id} initial={serializeItem(db, item)} />;
}
