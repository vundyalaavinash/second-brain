import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import type { PredictionDTO, PredictionsDTO } from "@/lib/dto";

let dir: string;
let r: {
  list: typeof import("./predictions/route");
  one: typeof import("./predictions/[id]/route");
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

/** The same request as `json`, but from a page on another origin — what `crossSite` gates on. */
const foreign = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { origin: "https://evil.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

const ESTIMATE = { kind: "estimate", claim: "Ledger migration", resolveBy: "2026-11-30", unit: "days", p50Low: 4, p50High: 6, p90Low: 3, p90High: 12 };

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    list: await import("./predictions/route"),
    one: await import("./predictions/[id]/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function log(body: unknown): Promise<PredictionDTO> {
  const res = await r.list.POST(json("POST", "/api/predictions", body));
  expect(res.status).toBe(201);
  return (await res.json()) as PredictionDTO;
}

describe("predictions api", () => {
  it("logs each kind and reads it back with only its own numbers", async () => {
    const estimate = await log(ESTIMATE);
    expect(estimate.p90High).toBe(12);
    expect(estimate.probability).toBeNull();

    const risk = await log({ kind: "risk", claim: "Reconciliation bug by launch + 30d", resolveBy: "2026-11-30", probability: 0.3 });
    expect(risk.probability).toBe(0.3);
    expect(risk.p90High).toBeNull();

    const call = await log({ kind: "call", claim: "Root cause was a retry storm", resolveBy: "2026-11-30" });
    expect(call.probability).toBeNull();
  });

  /** The union is what makes this a 400 rather than a quietly dropped field: an estimate carrying
   *  a probability is a caller that has misunderstood the shape, and saying so beats guessing. */
  it("refuses a kind carrying another kind's numbers", async () => {
    const res = await r.list.POST(json("POST", "/api/predictions", { ...ESTIMATE, probability: 0.3 }));
    expect(res.status).toBe(400);
  });

  it("refuses an unknown kind, and a body that is not JSON at all", async () => {
    expect((await r.list.POST(json("POST", "/api/predictions", { kind: "vibes", claim: "x", resolveBy: "2026-11-30" }))).status).toBe(400);
    const raw = new Request("http://localhost/api/predictions", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    expect((await r.list.POST(raw)).status).toBe(400);
  });

  /** `2026-13-45` matches the date regex but rolls over to another year; a permanent record must
   *  not take it. */
  it("refuses a resolve-by that is not a real calendar date", async () => {
    expect((await r.list.POST(json("POST", "/api/predictions", { kind: "call", claim: "x", resolveBy: "2026-13-45" }))).status).toBe(400);
  });

  it("surfaces the domain's own range arithmetic as a 400", async () => {
    const res = await r.list.POST(json("POST", "/api/predictions", { ...ESTIMATE, p90Low: 5, p90High: 12 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/contain the 50% range/);
  });

  it("carries the scores and the overdue set on the list payload", async () => {
    const res = await r.list.GET(json("GET", "/api/predictions?state=all"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PredictionsDTO;
    expect(body.scores.estimate.logged).toBeGreaterThan(0);
    // Nothing has resolved yet in this file, so the figures say so rather than reading as zero.
    expect(body.scores.estimate.percent).toBeNull();
    expect(Array.isArray(body.due)).toBe(true);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects a bad filter rather than ignoring it", async () => {
    expect((await r.list.GET(json("GET", "/api/predictions?kind=vibes"))).status).toBe(400);
    expect((await r.list.GET(json("GET", "/api/predictions?state=maybe"))).status).toBe(400);
  });

  /** The figures must not move when the view narrows: a calibration that jumped to 100% on
   *  clicking "scored" would read as progress. */
  it("scores the whole log regardless of the filter", async () => {
    const all = (await (await r.list.GET(json("GET", "/api/predictions?state=all"))).json()) as PredictionsDTO;
    const open = (await (await r.list.GET(json("GET", "/api/predictions?state=open"))).json()) as PredictionsDTO;
    expect(open.scores).toEqual(all.scores);
    expect(open.predictions.length).toBeLessThanOrEqual(all.predictions.length);
  });

  it("scores a call, and takes the score back", async () => {
    const row = await log({ kind: "call", claim: "resolvable", resolveBy: "2026-11-30" });
    const scored = (await (await r.one.PUT(json("PUT", `/api/predictions/${row.id}`, { outcome: true }), ctx(row.id))).json()) as PredictionDTO;
    expect(scored.outcome).toBe(1);
    expect(scored.resolvedAt).not.toBeNull();

    const back = (await (await r.one.PUT(json("PUT", `/api/predictions/${row.id}`, { unresolve: true }), ctx(row.id))).json()) as PredictionDTO;
    expect(back.resolvedAt).toBeNull();
    expect(back.outcome).toBeNull();
  });

  it("refuses a resolution that says two things at once, or nothing", async () => {
    const row = await log({ kind: "call", claim: "contradictory", resolveBy: "2026-11-30" });
    expect((await r.one.PUT(json("PUT", `/api/predictions/${row.id}`, { outcome: true, actual: 3 }), ctx(row.id))).status).toBe(400);
    expect((await r.one.PUT(json("PUT", `/api/predictions/${row.id}`, {}), ctx(row.id))).status).toBe(400);
  });

  it("edits the claim but has no way to edit the stated numbers", async () => {
    const row = await log(ESTIMATE);
    const res = await r.one.PATCH(json("PATCH", `/api/predictions/${row.id}`, { claim: "Ledger cut-over" }), ctx(row.id));
    expect(((await res.json()) as PredictionDTO).claim).toBe("Ledger cut-over");
    // `.strict()` is what makes this a 400 rather than a silently ignored field — the one edit
    // that would make every score in the log meaningless.
    expect((await r.one.PATCH(json("PATCH", `/api/predictions/${row.id}`, { p90High: 999 }), ctx(row.id))).status).toBe(400);
  });

  it("404s on a prediction that is not there", async () => {
    expect((await r.one.PUT(json("PUT", "/api/predictions/9999", { outcome: true }), ctx(9999))).status).toBe(404);
    expect((await r.one.DELETE(json("DELETE", "/api/predictions/9999"), ctx(9999))).status).toBe(404);
  });

  it("deletes a prediction", async () => {
    const row = await log({ kind: "call", claim: "doomed", resolveBy: "2026-11-30" });
    expect((await r.one.DELETE(json("DELETE", `/api/predictions/${row.id}`), ctx(row.id))).status).toBe(204);
    expect((await r.one.DELETE(json("DELETE", `/api/predictions/${row.id}`), ctx(row.id))).status).toBe(404);
  });

  it("refuses every write from another origin", async () => {
    const row = await log({ kind: "call", claim: "guarded", resolveBy: "2026-11-30" });
    expect((await r.list.POST(foreign("POST", "/api/predictions", ESTIMATE))).status).toBe(403);
    expect((await r.one.PUT(foreign("PUT", `/api/predictions/${row.id}`, { outcome: true }), ctx(row.id))).status).toBe(403);
    expect((await r.one.PATCH(foreign("PATCH", `/api/predictions/${row.id}`, { claim: "x" }), ctx(row.id))).status).toBe(403);
    expect((await r.one.DELETE(foreign("DELETE", `/api/predictions/${row.id}`), ctx(row.id))).status).toBe(403);
  });
});
