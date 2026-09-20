// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { TaskList } from "./task-list";
import type { TaskDTO } from "@/lib/dto";

// See container-editor.test.tsx: this vitest config has no global `afterEach`, so
// @testing-library/react's auto-cleanup never registers and DOM from one `it` would
// otherwise still be attached (and matched by role/name queries) in the next.
afterEach(cleanup);

const base: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: 5, sourceItemId: null,
  completedAt: null, sortOrder: 0, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};
const progress = { open: 1, done: 0, total: 1, percent: 0, nextTask: { id: 1, title: "Draft email", dueDate: null } };

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

describe("TaskList", () => {
  it("adds a task on Enter using quick-parse and keeps focus", async () => {
    const calls: unknown[] = [];
    stub(async (url, init) => {
      if (init?.method === "POST" && url === "/api/tasks") {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ...base, id: 2, title: "Ship it", priority: "high", dueDate: "2026-09-18" }), { status: 201 });
      }
      return new Response(JSON.stringify({ tasks: [base], progress }), { status: 200 });
    });
    render(<TaskList containerId={5} initialTasks={[base]} initialProgress={progress} today="2026-09-16" />);
    const input = screen.getByPlaceholderText("Add a task") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "! Ship it fri" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(calls[0]).toMatchObject({ title: "Ship it", priority: "high", containerId: 5 });
    expect((calls[0] as { dueDate: string }).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(await screen.findByText("Ship it")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("marks done with one PATCH and reverts on failure", async () => {
    const patches: unknown[] = [];
    let fail = false;
    stub(async (url, init) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        if (fail) return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
        return new Response(JSON.stringify({ ...base, status: "done", completedAt: "2026-09-16T01:00:00.000Z" }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [base], progress }), { status: 200 });
    });
    render(<TaskList containerId={5} initialTasks={[base]} initialProgress={progress} today="2026-09-16" />);
    const box = screen.getByRole("checkbox", { name: "Draft email" }) as HTMLInputElement;
    await act(async () => { fireEvent.click(box); });
    expect(patches).toEqual([{ status: "done" }]);
    expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
    fail = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /1 done/ })); });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    await act(async () => { fireEvent.click(reopen); });
    expect(await screen.findByText("Could not save that change")).toBeTruthy();
    expect(screen.getByRole("button", { name: /1 done/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
