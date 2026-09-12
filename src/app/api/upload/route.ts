import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { captureFile } from "@/domain/items/capture";
import { errorResponse, parseId, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    const tagsRaw = form.get("tags");
    const tags = typeof tagsRaw === "string" ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const containerRaw = form.get("containerId");
    const containerId = typeof containerRaw === "string" && containerRaw ? parseId(containerRaw) : null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const db = getDb();
    const item = captureFile(db, { bytes, name: file.name || "upload", mime: file.type || "application/octet-stream", tags, containerId });
    return NextResponse.json(serializeItem(db, item), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
