// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { isImageFile, uploadImage, insertImageWithUpload, handleFiles } from "./images";

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

function makeEditor(): Editor {
  const el = document.createElement("div");
  return new Editor({ element: el, extensions: buildExtensions({}), content: "", contentType: "markdown" });
}

/** Waits out the microtask chain behind `insertImageWithUpload`'s upload promise
 * (`uploadImage(...).then(...).catch(...)`), which isn't awaited by its caller. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("insertImageWithUpload", () => {
  it("swaps the placeholder for the uploaded image markdown, with no placeholder text left behind", async () => {
    const editor = makeEditor();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 3, url: "/api/attachments/3" }), { status: 201 })));
    insertImageWithUpload(editor, new File(["x"], "shot.png", { type: "image/png" }), 7);
    await flush();
    const md = editor.getMarkdown();
    expect(md).toContain("![shot.png](/api/attachments/3)");
    expect(md).not.toContain("Uploading image");
    editor.destroy();
    vi.unstubAllGlobals();
  });

  it("shows an uploadFailed node and never serialises the placeholder or a partial image on rejection", async () => {
    const editor = makeEditor();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Upload failed" }), { status: 500 })));
    insertImageWithUpload(editor, new File(["x"], "shot.png", { type: "image/png" }), 7);
    await flush();
    let hasUploadFailed = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "uploadFailed") hasUploadFailed = true;
    });
    expect(hasUploadFailed).toBe(true);
    const md = editor.getMarkdown();
    expect(md).not.toContain("Uploading image");
    expect(md).not.toContain("![shot.png]");
    editor.destroy();
    vi.unstubAllGlobals();
  });
});

describe("handleFiles", () => {
  it("uploads a non-image file through /api/upload and inserts a link to the new item", async () => {
    const editor = makeEditor();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 9, title: "doc.pdf" }), { status: 201 })));
    handleFiles(editor, [new File(["x"], "doc.pdf", { type: "application/pdf" })], 7);
    await flush();
    expect(editor.getMarkdown()).toContain("[doc.pdf](/items/9)");
    editor.destroy();
    vi.unstubAllGlobals();
  });
});
