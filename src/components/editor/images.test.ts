import { describe, it, expect, vi } from "vitest";
import { isImageFile, uploadImage } from "./images";

describe("images", () => {
  it("recognises allowed image types", () => {
    expect(isImageFile(new File([""], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([""], "a.svg", { type: "image/svg+xml" }))).toBe(false);
    expect(isImageFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("uploads and surfaces server errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 3, url: "/api/attachments/3" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Images must be 20 MB or smaller" }), { status: 413 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadImage(new File(["x"], "a.png", { type: "image/png" }), 7)).toEqual({ url: "/api/attachments/3" });
    const body = fetchMock.mock.calls[0][1] as RequestInit;
    expect((body.body as FormData).get("itemId")).toBe("7");
    await expect(uploadImage(new File(["x"], "a.png", { type: "image/png" }), 7)).rejects.toThrow(/20 MB/);
    vi.unstubAllGlobals();
  });
});
