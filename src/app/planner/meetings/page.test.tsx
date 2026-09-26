import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let PlannerMeetingsPage: typeof import("./page").default;

beforeAll(async () => {
  dir = makeTempDataDir();
  PlannerMeetingsPage = (await import("./page")).default;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The React element the page returns, read for the `from`/`to` window it hands `PlannerShell` --
 * never rendered, the same approach `src/app/c/[slug]/page.test.tsx` takes. */
type ShellProps = { initial: { from: string; to: string } };

describe("PlannerMeetingsPage", () => {
  it("uses the normal 90-day window with no ?container=", async () => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({}) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from < el.props.initial.to).toBe(true);
    expect(el.props.initial.from).not.toBe("0001-01-01");
  });

  it("widens to all time when ?container= names one, so 'See all in Planner' genuinely means all (review F2)", async () => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({ container: "5" }) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from).toBe("0001-01-01");
    expect(el.props.initial.to).toBe("9999-12-31");
  });

  it("ignores a malformed ?container= and keeps the normal window", async () => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({ container: "abc" }) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from).not.toBe("0001-01-01");
  });
});
