"use client";
import type { ItemDTO } from "@/lib/dto";

export interface CaptureOptions {
  tags?: string[];
  containerId?: number | null;
  /** Links only: save even though the URL is already in the library. */
  force?: boolean;
}

/** A link the library already holds, answered by the capture endpoint with a 409. */
export interface DuplicateLink {
  duplicate: number;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function captureNote(body: string, opts: CaptureOptions = {}): Promise<ItemDTO> {
  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "note", body, tags: opts.tags ?? [], containerId: opts.containerId ?? null }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ItemDTO;
}

async function captureLink(url: string, opts: CaptureOptions = {}): Promise<ItemDTO | DuplicateLink> {
  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "link", url, tags: opts.tags ?? [], containerId: opts.containerId ?? null, force: opts.force ?? false }),
  });
  if (res.status === 409) {
    const data = (await res.json()) as { existingId: number };
    return { duplicate: data.existingId };
  }
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ItemDTO;
}

async function uploadFiles(files: File[], opts: CaptureOptions = {}): Promise<ItemDTO[]> {
  const created: ItemDTO[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("tags", (opts.tags ?? []).join(","));
    if (opts.containerId != null) form.append("containerId", String(opts.containerId));
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (!res.ok) throw new Error(await readError(res));
    created.push((await res.json()) as ItemDTO);
  }
  return created;
}

/** The three capture requests, shared by the capture box and the prompt bar. The object is
 * a module constant, so it never re-triggers a caller's effects. */
const capture = { captureNote, captureLink, uploadFiles } as const;

export function useCapture(): typeof capture {
  return capture;
}
