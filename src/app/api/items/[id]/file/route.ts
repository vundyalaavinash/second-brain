import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getItem } from "@/domain/items";
import { absoluteFilePath } from "@/lib/files";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

const INLINE_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const item = getItem(getDb(), id);
    if (!item || !item.filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const abs = absoluteFilePath(item.filePath);
    if (!fs.existsSync(abs)) return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
    const bytes = fs.readFileSync(abs);
    const mimeType = item.mimeType ?? "application/octet-stream";
    const disposition = INLINE_MIME_TYPES.has(mimeType) ? "inline" : "attachment";
    return new Response(bytes, {
      headers: {
        "content-type": mimeType,
        "content-disposition": `${disposition}; filename="${path.basename(item.filePath).replace(/"/g, "")}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
