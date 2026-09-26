import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { createContainer } from "@/domain/containers";
import { createItem, fileItem } from "@/domain/items";
import { replaceCalendarEvents, captureMeeting } from "@/domain/activity/calendar";
import type { ContainerMeetingDTO, ItemDTO } from "@/lib/dto";

let dir: string;
let ContainerPage: typeof import("./page").default;

beforeAll(async () => {
  dir = makeTempDataDir();
  ContainerPage = (await import("./page")).default;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The React element `ContainerPage` returns — never rendered, just read for the props it hands
 * `ContainerEditor`, the same wiring `src/app/page.test.tsx` checks for the Home route. */
type ContainerEditorProps = { items: ItemDTO[]; meetings: ContainerMeetingDTO[] };

describe("ContainerPage", () => {
  it("hands the project's own meetings to ContainerEditor as their own prop, badged and dated", async () => {
    const db = getDb();
    const project = createContainer(db, { kind: "project", name: "Launch v3" });
    replaceCalendarEvents(db, [
      { externalId: "e1", title: "Kickoff", startsAt: "2026-09-20T14:00:00.000Z", endsAt: "2026-09-20T14:30:00.000Z", attendees: 2, hasCallLink: false },
    ]);
    const ev = db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "e1")).get()!;
    const meetingItem = captureMeeting(db, ev.id);
    fileItem(db, meetingItem.id, project.id);
    createItem(db, { type: "note", title: "Plan", containerId: project.id });

    const el = (await ContainerPage({ params: Promise.resolve({ slug: project.slug }) })) as unknown as { props: ContainerEditorProps };
    expect(el.props.meetings).toEqual([{ title: "Kickoff", startsAt: "2026-09-20T14:00:00.000Z", item: { id: meetingItem.id, hasNotes: false, hasTranscript: false, hasSummary: false, containerId: project.id } }]);
    // The generic `items` list still carries the raw item -- `ContainerEditor` itself is what
    // keeps a meeting out of the "Files and other items" bucket, not the page.
    expect(el.props.items.some((i) => i.id === meetingItem.id)).toBe(true);
  });

  it("404s a slug with no container behind it", async () => {
    await expect(ContainerPage({ params: Promise.resolve({ slug: "no-such-project" }) })).rejects.toThrow();
  });
});
