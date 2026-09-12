import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import type { ItemDTO, ContainerDTO, PersonDTO } from "@/lib/dto";

let dir: string;
let r: {
  items: typeof import("./items/route");
  item: typeof import("./items/[id]/route");
  containers: typeof import("./containers/route");
  container: typeof import("./containers/[id]/route");
  archive: typeof import("./containers/[id]/archive/route");
  restore: typeof import("./containers/[id]/restore/route");
  inbox: typeof import("./inbox/route");
  people: typeof import("./people/route");
  person: typeof import("./people/[id]/route");
  search: typeof import("./search/route");
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  const { setEmbedProviderForTests } = await import("@/server/providers");
  setEmbedProviderForTests(createFakeEmbedProvider());
  r = {
    items: await import("./items/route"),
    item: await import("./items/[id]/route"),
    containers: await import("./containers/route"),
    container: await import("./containers/[id]/route"),
    archive: await import("./containers/[id]/archive/route"),
    restore: await import("./containers/[id]/restore/route"),
    inbox: await import("./inbox/route"),
    people: await import("./people/route"),
    person: await import("./people/[id]/route"),
    search: await import("./search/route"),
  };
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("containers api", () => {
  it("creates, lists, updates, archives with re-homing, restores, and deletes", async () => {
    const created = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Launch", deadline: "2026-10-01" }));
    expect(created.status).toBe(201);
    const project = (await created.json()) as ContainerDTO;
    expect(project.slug).toBe("launch");
    const areaRes = await r.containers.POST(json("POST", "/api/containers", { kind: "area", name: "Marketing" }));
    const area = (await areaRes.json()) as ContainerDTO;
    expect((await r.containers.POST(json("POST", "/api/containers", { kind: "nope", name: "x" }))).status).toBe(400);

    const list = (await (await r.containers.GET(json("GET", "/api/containers?kind=project"))).json()) as ContainerDTO[];
    expect(list.map((c) => c.id)).toEqual([project.id]);

    const noteRes = await r.items.POST(json("POST", "/api/items", { type: "note", body: "In the project", containerId: project.id }));
    const note = (await noteRes.json()) as ItemDTO;
    expect(note.containerId).toBe(project.id);
    expect(note.container?.slug).toBe("launch");
    expect((await r.items.POST(json("POST", "/api/items", { type: "note", body: "x", containerId: 99999 }))).status).toBe(400);

    const patched = (await (await r.container.PATCH(json("PATCH", `/api/containers/${project.id}`, { goal: "Ship" }), params(project.id))).json()) as ContainerDTO;
    expect(patched.goal).toBe("Ship");
    expect(patched.itemCount).toBe(1);
    expect(patched.totalItemCount).toBe(1);

    const badJson = new Request(`http://localhost/api/containers/${project.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await r.archive.POST(badJson, params(project.id))).status).toBe(400);

    const archived = (await (await r.archive.POST(json("POST", `/api/containers/${project.id}/archive`, { moveItemsTo: area.id }), params(project.id))).json()) as ContainerDTO;
    expect(archived.status).toBe("archived");
    const moved = (await (await r.item.GET(json("GET", `/api/items/${note.id}`), params(note.id))).json()) as ItemDTO;
    expect(moved.containerId).toBe(area.id);
    const areaAfterMove = (await (await r.container.GET(json("GET", `/api/containers/${area.id}`), params(area.id))).json()) as ContainerDTO;
    expect(areaAfterMove.totalItemCount).toBe(1);

    const restored = (await (await r.restore.POST(json("POST", `/api/containers/${project.id}/restore`), params(project.id))).json()) as ContainerDTO;
    expect(restored.status).toBe("active");
    expect((await r.container.DELETE(json("DELETE", `/api/containers/${area.id}`), params(area.id))).status).toBe(409);
    expect((await r.container.DELETE(json("DELETE", `/api/containers/${project.id}`), params(project.id))).status).toBe(204);
    expect((await r.container.GET(json("GET", `/api/containers/${project.id}`), params(project.id))).status).toBe(404);
  });
});

describe("inbox, homes, archive, duplicates", () => {
  it("lists the inbox, files and archives items, and rejects duplicate links", async () => {
    const a = (await (await r.items.POST(json("POST", "/api/items", { type: "note", body: "inbox a" }))).json()) as ItemDTO;
    const inbox = (await (await r.inbox.GET(json("GET", "/api/inbox"))).json()) as { count: number; items: ItemDTO[] };
    expect(inbox.count).toBeGreaterThanOrEqual(1);
    expect(inbox.items.map((i) => i.id)).toContain(a.id);

    const areaRes = await r.containers.POST(json("POST", "/api/containers", { kind: "resource", name: "Reading", category: "articles" }));
    const area = (await areaRes.json()) as ContainerDTO;
    const filed = (await (await r.item.PATCH(json("PATCH", `/api/items/${a.id}`, { containerId: area.id }), params(a.id))).json()) as ItemDTO;
    expect(filed.containerId).toBe(area.id);
    const byContainer = (await (await r.items.GET(json("GET", `/api/items?container=${area.id}`))).json()) as ItemDTO[];
    expect(byContainer.map((i) => i.id)).toEqual([a.id]);
    const onlyInbox = (await (await r.items.GET(json("GET", "/api/items?container=inbox"))).json()) as ItemDTO[];
    expect(onlyInbox.map((i) => i.id)).not.toContain(a.id);

    const archived = (await (await r.item.PATCH(json("PATCH", `/api/items/${a.id}`, { archived: true }), params(a.id))).json()) as ItemDTO;
    expect(archived.archivedAt).toBeTruthy();
    expect(((await (await r.items.GET(json("GET", `/api/items?container=${area.id}`))).json()) as ItemDTO[])).toEqual([]);
    expect(((await (await r.items.GET(json("GET", `/api/items?container=${area.id}&archived=1`))).json()) as ItemDTO[]).map((i) => i.id)).toEqual([a.id]);
    expect((await r.search.GET(json("GET", "/api/search?q=inbox&archived=1"))).status).toBe(200);

    const first = await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup?utm_source=x" }));
    expect(first.status).toBe(201);
    const firstItem = (await first.json()) as ItemDTO;
    const dup = await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup" }));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { existingId: number }).existingId).toBe(firstItem.id);
    expect((await r.items.POST(json("POST", "/api/items", { type: "link", url: "https://example.test/dup", force: true }))).status).toBe(201);
  });
});

describe("people api", () => {
  it("creates people, links them to items, and returns a timeline", async () => {
    const created = await r.people.POST(json("POST", "/api/people", { name: "Ada Lovelace" }));
    expect(created.status).toBe(201);
    const ada = (await created.json()) as PersonDTO;
    const note = (await (await r.items.POST(json("POST", "/api/items", { type: "note", body: "Call with @ada-lovelace" }))).json()) as ItemDTO;
    expect(note.people.map((p) => p.id)).toEqual([ada.id]);
    const detail = (await (await r.person.GET(json("GET", `/api/people/${ada.id}`), params(ada.id))).json()) as { person: PersonDTO; timeline: ItemDTO[] };
    expect(detail.person.itemCount).toBe(1);
    expect(detail.timeline.map((i) => i.id)).toEqual([note.id]);
    const cleared = (await (await r.item.PATCH(json("PATCH", `/api/items/${note.id}`, { people: [] }), params(note.id))).json()) as ItemDTO;
    expect(cleared.people).toEqual([]);
    const list = (await (await r.people.GET()).json()) as PersonDTO[];
    expect(list.map((p) => p.slug)).toContain("ada-lovelace");
    expect((await r.person.DELETE(json("DELETE", `/api/people/${ada.id}`), params(ada.id))).status).toBe(204);
  });
});
