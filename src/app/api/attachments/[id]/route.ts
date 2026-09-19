import fs from "node:fs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { attachmentPath, getAttachment } from "@/domain/attachments";
import { errorResponse, parseId } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const a = getAttachment(getDb(), id);
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const file = attachmentPath(a);
    if (!fs.existsSync(file)) return NextResponse.json({ error: "File missing" }, { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: {
        "content-type": a.mime,
        "content-length": String(a.bytes),
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
