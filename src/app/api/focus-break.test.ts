import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { setFocusSettings } from "@/domain/focus";
import { breakState } from "@/domain/focus/break";

let t: TestDb;

vi.mock("@/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/db/client")>("@/db/client");
  return { ...actual, getDb: () => t.db };
});

function post(body: unknown): Request {
  return new Request("http://127.0.0.1:3141/api/focus/break", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:3141", host: "127.0.0.1:3141" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/focus/break", () => {
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("starts the break the cycle calls for when no length is given", async () => {
    setFocusSettings(t.db, { shortBreak: 7, longBreak: 20, longBreakEvery: 4 });
    const { POST } = await import("./focus/break/route");

    const res = await POST(post({}));

    expect(res.status).toBe(201);
    // Nothing completed yet, so the cycle asks for the short one.
    expect((await res.json()).minutes).toBe(7);
  });

  it("takes an explicit length", async () => {
    const { POST } = await import("./focus/break/route");
    const res = await POST(post({ minutes: 12 }));
    expect((await res.json()).minutes).toBe(12);
  });

  it("refuses a length outside the bounds rather than storing it", async () => {
    const { POST } = await import("./focus/break/route");
    const res = await POST(post({ minutes: 900 }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(breakState(t.db).endsAt).toBeNull();
  });

  it("ends a break, and ending one nobody is on is not an error", async () => {
    const { POST, DELETE } = await import("./focus/break/route");
    await POST(post({ minutes: 5 }));
    expect(breakState(t.db).endsAt).not.toBeNull();

    const del = new Request("http://127.0.0.1:3141/api/focus/break", {
      method: "DELETE",
      headers: { origin: "http://127.0.0.1:3141", host: "127.0.0.1:3141" },
    });
    expect((await DELETE(del)).status).toBe(200);
    expect(breakState(t.db).endsAt).toBeNull();
    expect((await DELETE(del)).status).toBe(200);
  });
});
