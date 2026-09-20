import { eq, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { containers, tasks } from "@/db/schema";
import { getSetting, setSetting } from "@/domain/settings";
import { nowIso } from "@/lib/time";

const CHECKBOX = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;

/** One-time: convert every container's next-steps checklist into tasks. Guarded by the `tasks_migrated` setting. */
export function migrateNextSteps(db: DB): { containers: number; tasks: number } {
  if (getSetting(db, "tasks_migrated", "0") === "1") return { containers: 0, tasks: 0 };
  const rows = db.select().from(containers).where(ne(containers.nextSteps, "")).all();
  let taskCount = 0;
  db.transaction((tx) => {
    for (const c of rows) {
      const lines = c.nextSteps.split("\n");
      const stray: string[] = [];
      let order = 0;
      const now = nowIso();
      for (const line of lines) {
        const m = CHECKBOX.exec(line);
        if (m) {
          const done = m[1].toLowerCase() === "x";
          tx.insert(tasks)
            .values({
              title: m[2],
              status: done ? "done" : "open",
              completedAt: done ? now : null,
              containerId: c.id,
              sortOrder: order++,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          taskCount++;
        } else if (line.trim()) {
          stray.push(line.trim());
        }
      }
      let description = c.description;
      const extra = stray.filter((s) => !description.includes(s));
      if (extra.length) description = `${description.trimEnd()}\n\n## Notes\n\n${extra.join("\n")}`.trimStart();
      tx.update(containers).set({ nextSteps: "", description, updatedAt: now }).where(eq(containers.id, c.id)).run();
    }
    setSetting(tx as unknown as DB, "tasks_migrated", "1");
  });
  return { containers: rows.length, tasks: taskCount };
}
