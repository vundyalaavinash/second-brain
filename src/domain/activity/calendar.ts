import type { DB } from "@/db/client";
import type { CalendarEvent } from "@/db/schema";

export function findMeetingFor(_db: DB, _at: string): CalendarEvent | undefined {
  return undefined;
}
