import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, type TestDb } from "@/test/db";
import { containers } from "@/db/schema";
import { createContainer, getContainer } from "@/domain/containers";
import { listTasks } from "./index";
import { migrateNextSteps } from "./migrate-next-steps";
import { getSetting } from "@/domain/settings";

describe("migrateNextSteps", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("turns checkbox lines into tasks, keeps stray lines in the description, and runs once", () => {
    const p = createContainer(t.db, { kind: "project", name: "Launch", description: "Intro." });
    t.db
      .update(containers)
      .set({ nextSteps: "- [ ] Draft email\n* [X] Pick tool\nRemember the budget\n\n- [ ] Import contacts" })
      .where(eq(containers.id, p.id))
      .run();
    const untouched = createContainer(t.db, { kind: "area", name: "Home" });
    const r = migrateNextSteps(t.db);
    expect(r).toEqual({ containers: 1, tasks: 3 });
    const all = listTasks(t.db, { containerId: p.id, status: "all" });
    expect(all.map((x) => [x.title, x.status])).toEqual([
      ["Draft email", "open"],
      ["Import contacts", "open"],
      ["Pick tool", "done"],
    ]);
    expect(all.find((x) => x.title === "Pick tool")?.completedAt).not.toBeNull();
    const c = getContainer(t.db, p.id)!;
    expect(c.nextSteps).toBe("");
    expect(c.description).toBe("Intro.\n\n## Notes\n\nRemember the budget");
    expect(getSetting(t.db, "tasks_migrated", "0")).toBe("1");
    expect(getContainer(t.db, untouched.id)?.description).toBe("");
    expect(migrateNextSteps(t.db)).toEqual({ containers: 0, tasks: 0 });
    expect(listTasks(t.db, { containerId: p.id, status: "all" })).toHaveLength(3);
  });
});
