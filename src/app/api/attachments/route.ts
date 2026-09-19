import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { saveAttachment } from "@/domain/attachments";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const itemRaw = form.get("itemId");
    if (!(file instanceof File) || typeof itemRaw !== "string") return NextResponse.json({ error: "Missing itemId or file field" }, { status: 400 });
    const itemId = parseId(itemRaw);
    const bytes = Buffer.from(await file.arrayBuffer());
    const a = saveAttachment(getDb(), { itemId, filename: file.name || "image", mime: file.type, bytes });
    return NextResponse.json({ id: a.id, url: `/api/attachments/${a.id}`, filename: a.filename, mime: a.mime, bytes: a.bytes }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
