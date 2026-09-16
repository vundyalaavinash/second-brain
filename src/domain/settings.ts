import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { settings } from "@/db/schema";

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? fallback;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
