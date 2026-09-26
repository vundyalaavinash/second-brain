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

/** The React element the page returns, read for what it hands `PlannerShell` -- never rendered,
 * the same approach `src/app/c/[slug]/page.test.tsx` takes. */
type ShellProps = { initial: { from: string; to: string; containerId: number | null } };

describe("PlannerMeetingsPage", () => {
  it("uses the normal 90-day window and a null containerId with no ?container=", async () => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({}) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from < el.props.initial.to).toBe(true);
    expect(el.props.initial.from).not.toBe("0001-01-01");
    expect(el.props.initial.containerId).toBeNull();
  });

  it("widens to all time and resolves the id when ?container= names one, so 'See calendar meetings in Planner' genuinely means all of them (review F2)", async () => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({ container: "5" }) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from).toBe("0001-01-01");
    expect(el.props.initial.to).toBe("9999-12-31");
    expect(el.props.initial.containerId).toBe(5);
  });

  // review N1: the client used to re-parse `?container=` itself with a looser rule
  // (`Number.isInteger(Number(raw)) && n > 0`) that disagreed with this page's on `0`, decimals,
  // and leading zeros. Resolving the id once, here, and passing it down as a prop means there is
  // now exactly one rule -- these cases only need to be right in one place.
  it.each([["abc"], ["0"], ["-5"], ["5.5"], ["007"], ["5e2"]])("treats %s as no filter -- the normal window, containerId null", async (raw) => {
    const el = (await PlannerMeetingsPage({ searchParams: Promise.resolve({ container: raw }) })) as unknown as { props: ShellProps };
    expect(el.props.initial.from).not.toBe("0001-01-01");
    expect(el.props.initial.containerId).toBeNull();
  });
});
