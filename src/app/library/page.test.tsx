// @vitest-environment jsdom
import fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { createItem, mergeItemMeta } from "@/domain/items";
import LibraryPage from "./page";

let dir: string;
beforeEach(() => {
  dir = makeTempDataDir();
});
afterEach(() => {
  cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const db = getDb();
  const kept = createItem(db, { type: "note", title: "Kept note", body: "x" });
  mergeItemMeta(db, kept.id, { distillation: { gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "kept" } });
  createItem(db, { type: "note", title: "Plain note", body: "x" });
  return { kept };
}

describe("LibraryPage", () => {
  it("badges a row with a kept distillation and leaves an undistilled row plain", async () => {
    seed();
    const el = await LibraryPage({ searchParams: Promise.resolve({}) });
    render(el);

    const keptRow = screen.getByText("Kept note").closest("li")!;
    expect(within(keptRow).getByText("Distilled")).toBeTruthy();
    const plainRow = screen.getByText("Plain note").closest("li")!;
    expect(within(plainRow).queryByText("Distilled")).toBeNull();
  });

  it("the Distilled filter narrows the list, and its chip round-trips through the URL", async () => {
    seed();

    const unfiltered = await LibraryPage({ searchParams: Promise.resolve({}) });
    render(unfiltered);
    const offChip = screen.getByRole("link", { name: "Distilled" });
    expect(offChip.getAttribute("href")).toBe("/library?distilled=1");
    cleanup();

    const filtered = await LibraryPage({ searchParams: Promise.resolve({ distilled: "1" }) });
    render(filtered);
    expect(screen.getByText("Kept note")).toBeTruthy();
    expect(screen.queryByText("Plain note")).toBeNull();
    const onChip = screen.getByRole("link", { name: "Distilled" });
    expect(onChip.getAttribute("href")).toBe("/library");
  });
});
