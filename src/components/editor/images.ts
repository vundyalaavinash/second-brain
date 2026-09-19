import type { Editor } from "@tiptap/core";

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function isImageFile(file: File): boolean {
  return IMAGE_MIMES.includes(file.type);
}

export async function uploadImage(file: File, itemId: number): Promise<{ url: string }> {
  const form = new FormData();
  form.set("itemId", String(itemId));
  form.set("file", file);
  const res = await fetch("/api/attachments", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { url: data.url };
}

export async function uploadFileAsItem(file: File): Promise<{ id: number; title: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { id?: number; title?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return { id: data.id, title: data.title ?? file.name };
}

let uploadSeq = 0;

/** Insert a placeholder at the selection, upload, then swap in the image or a failure node. */
export function insertImageWithUpload(editor: Editor, file: File, itemId: number | undefined): void {
  if (itemId === undefined) {
    editor
      .chain()
      .focus()
      .insertContent({ type: "uploadFailed", attrs: { name: file.name, reason: "Save the note before adding images" } })
      .run();
    return;
  }
  const id = `upload-${++uploadSeq}`;
  editor
    .chain()
    .focus()
    .insertContent({ type: "paragraph", attrs: { uploadId: id }, content: [{ type: "text", text: "Uploading image" }] })
    .run();
  const replace = (content: object) => {
    const { doc } = editor.state;
    let from = -1;
    let to = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.attrs.uploadId === id) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (from >= 0) editor.chain().insertContentAt({ from, to }, content).run();
  };
  uploadImage(file, itemId)
    .then(({ url }) => replace({ type: "image", attrs: { src: url, alt: file.name } }))
    .catch((err: unknown) => replace({ type: "uploadFailed", attrs: { name: file.name, reason: err instanceof Error ? err.message : "Upload failed" } }));
}

export function handleFiles(editor: Editor, files: File[], itemId: number | undefined): boolean {
  if (files.length === 0) return false;
  for (const file of files) {
    if (isImageFile(file)) {
      insertImageWithUpload(editor, file, itemId);
    } else {
      void uploadFileAsItem(file)
        .then(({ id, title }) =>
          editor
            .chain()
            .focus()
            .insertContent({ type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "link", attrs: { href: `/items/${id}` } }] }] })
            .run(),
        )
        .catch((err: unknown) =>
          editor
            .chain()
            .focus()
            .insertContent({ type: "uploadFailed", attrs: { name: file.name, reason: err instanceof Error ? err.message : "Upload failed" } })
            .run(),
        );
    }
  }
  return true;
}
