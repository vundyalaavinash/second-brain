import { describe, it, expect } from "vitest";
import { planMinutesType, readPlanMinutes, PLAN_DRAG_MIME } from "./drag-mime";

describe("plan drag types", () => {
  it("spells the block's length into a type the ghost can read back", () => {
    expect(planMinutesType(45)).toBe("application/x-sb-plan-minutes-45");
    expect(readPlanMinutes([PLAN_DRAG_MIME, planMinutesType(45)])).toBe(45);
  });

  it("rounds to whole minutes and never goes below zero", () => {
    expect(planMinutesType(24.6)).toBe("application/x-sb-plan-minutes-25");
    expect(planMinutesType(-5)).toBe("application/x-sb-plan-minutes-0");
  });

  it("answers null for a drag that declares no length", () => {
    expect(readPlanMinutes([PLAN_DRAG_MIME, "text/plain"])).toBeNull();
    expect(readPlanMinutes([])).toBeNull();
    // Zero is no length at all, and neither is a type that only looks like one.
    expect(readPlanMinutes([planMinutesType(0)])).toBeNull();
    expect(readPlanMinutes(["application/x-sb-plan-minutes-", "application/x-sb-plan-minutes-12x"])).toBeNull();
  });
});
