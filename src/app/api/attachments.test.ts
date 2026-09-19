import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { upload: typeof import("./attachments/route"); file: typeof import("./attachments/[id]/route") };
let itemId: number;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function multipart(itemId: number, name: string, mime: string, bytes: Buffer): Request {
  const form = new FormData();
  form.set("itemId", String(itemId));
  form.set("file", new File([new Uint8Array(bytes)], name, { type: mime }));
  return new Request("http://localhost/api/attachments", { method: "POST", body: form });
}
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { upload: await import("./attachments/route"), file: await import("./attachments/[id]/route") };
  // src/app/api/items/route.ts's POST requires a non-empty note body, which the upstream
  // brief's fixture body ("") fails; create the item directly through the domain capture
  // helper instead. The test's assertions are about attachments, not capture.
  const { getDb } = await import("@/db/client");
  const { captureNote } = await import("@/domain/items/capture");
  itemId = captureNote(getDb(), { title: "n", body: "n" }).id;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("attachments api", () => {
  it("uploads, serves, and rejects", async () => {
    const up = await r.upload.POST(multipart(itemId, "shot.png", "image/png", PNG));
    expect(up.status).toBe(201);
    const a = (await up.json()) as { id: number; url: string; mime: string };
    expect(a.url).toBe(`/api/attachments/${a.id}`);
    const got = await r.file.GET(new Request("http://localhost" + a.url), params(a.id));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PNG);
    expect((await r.upload.POST(multipart(itemId, "x.svg", "image/svg+xml", PNG))).status).toBe(415);
    expect((await r.upload.POST(multipart(999, "x.png", "image/png", PNG))).status).toBe(404);
    expect((await r.file.GET(new Request("http://localhost/api/attachments/999"), params(999))).status).toBe(404);
    const missing = await r.upload.POST(new Request("http://localhost/api/attachments", { method: "POST", body: new FormData() }));
    expect(missing.status).toBe(400);
  });
});
