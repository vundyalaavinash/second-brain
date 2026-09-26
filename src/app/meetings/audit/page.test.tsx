import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { setRetentionDays } from "@/domain/activity";

let dir: string;
let MeetingsAuditPage: typeof import("./page").default;

beforeAll(async () => {
  dir = makeTempDataDir();
  MeetingsAuditPage = (await import("./page")).default;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The React element the page returns, read for what it hands `AuditView` -- never rendered,
 * the same approach `src/app/planner/meetings/page.test.tsx` takes. */
type ViewProps = { windowDays: number };

beforeEach(() => setRetentionDays(getDb(), 90));

describe("MeetingsAuditPage", () => {
  // F10: the audit's 90-day window used to be hardcoded independent of the person's own
  // configurable retention setting, so a retention set below 90 would still have the page claim
  // to cover 90 days of data most of which no longer survives to be counted.
  it("uses the full 90-day window when retention is at or above it", () => {
    setRetentionDays(getDb(), 90);
    const el = MeetingsAuditPage() as unknown as { props: ViewProps };
    expect(el.props.windowDays).toBe(90);
  });

  it("uses the full 90-day window when retention is generously above it", () => {
    setRetentionDays(getDb(), 365);
    const el = MeetingsAuditPage() as unknown as { props: ViewProps };
    expect(el.props.windowDays).toBe(90);
  });

  it("narrows the window to a retention setting below 90, rather than claiming to cover data that has already aged out", () => {
    setRetentionDays(getDb(), 30);
    const el = MeetingsAuditPage() as unknown as { props: ViewProps };
    expect(el.props.windowDays).toBe(30);
  });

  it("narrows all the way down for a retention setting of exactly one day", () => {
    setRetentionDays(getDb(), 1);
    const el = MeetingsAuditPage() as unknown as { props: ViewProps };
    expect(el.props.windowDays).toBe(1);
  });
});
