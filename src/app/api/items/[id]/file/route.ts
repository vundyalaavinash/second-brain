import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getItem } from "@/domain/items";
import { absoluteFilePath } from "@/lib/files";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const item = getItem(getDb(), id);
    if (!item || !item.filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const abs = absoluteFilePath(item.filePath);
    if (!fs.existsSync(abs)) return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
    const bytes = fs.readFileSync(abs);
    return new Response(bytes, {
      headers: {
        "content-type": item.mimeType ?? "application/octet-stream",
        "content-disposition": `inline; filename="${path.basename(item.filePath).replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
